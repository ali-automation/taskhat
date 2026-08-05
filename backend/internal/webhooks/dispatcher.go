// Package webhooks delivers domain events to admin-configured HTTP endpoints,
// signed with HMAC-SHA256, with retries and a delivery log.
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

type Dispatcher struct {
	st     *store.Store
	log    *slog.Logger
	client *http.Client
}

func New(st *store.Store, log *slog.Logger) *Dispatcher {
	return &Dispatcher{st: st, log: log, client: &http.Client{Timeout: 10 * time.Second}}
}

// projectKeyOf digs the space key out of an event payload for scope filtering.
func projectKeyOf(eventType string, payload json.RawMessage) string {
	switch {
	case strings.HasPrefix(eventType, "comment."):
		var v struct {
			Issue struct {
				ProjectKey string `json:"projectKey"`
			} `json:"issue"`
		}
		_ = json.Unmarshal(payload, &v)
		return v.Issue.ProjectKey
	default:
		var v struct {
			ProjectKey string `json:"projectKey"`
			Key        string `json:"key"` // issue.deleted / project.created carry a bare key
		}
		_ = json.Unmarshal(payload, &v)
		if v.ProjectKey != "" {
			return v.ProjectKey
		}
		if i := strings.IndexByte(v.Key, '-'); i > 0 {
			return v.Key[:i] // "TH-12" → "TH"
		}
		return v.Key
	}
}

// summaryOf produces the short delivery-log label ("TH-12", "TH", …).
func summaryOf(payload json.RawMessage) string {
	var v struct {
		Key string `json:"key"`
	}
	_ = json.Unmarshal(payload, &v)
	return v.Key
}

var retryDelays = []time.Duration{0, 2 * time.Second, 8 * time.Second}

// Handle fans one domain event out to every matching webhook.
func (d *Dispatcher) Handle(e events.Event) error {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	projectKey := projectKeyOf(e.Type, e.Payload)
	hooks, err := d.st.WebhooksForEvent(ctx, e.Type, projectKey)
	if err != nil {
		return fmt.Errorf("webhooks lookup: %w", err)
	}
	if len(hooks) == 0 {
		return nil
	}

	body, err := json.Marshal(map[string]any{
		"event":     e.Type,
		"timestamp": e.OccurredAt,
		"actorId":   e.ActorID,
		"data":      json.RawMessage(e.Payload),
	})
	if err != nil {
		return nil // malformed payload: don't requeue
	}

	for _, hook := range hooks {
		d.deliver(ctx, hook, e.Type, body, summaryOf(e.Payload))
	}
	return nil
}

func (d *Dispatcher) deliver(ctx context.Context, hook store.Webhook, eventType string, body []byte, summary string) {
	var status int
	var lastErr string
	attempts := 0

	for i, delay := range retryDelays {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				lastErr = "timed out waiting to retry"
				break
			}
		}
		attempts = i + 1
		status, lastErr = d.post(ctx, hook, eventType, body)
		if status >= 200 && status < 300 {
			break
		}
	}

	d.st.RecordDelivery(ctx, hook.ID, eventType, status, lastErr, attempts, summary)
	if status < 200 || status >= 300 {
		d.log.Warn("webhook delivery failed", "webhook", hook.Name, "url", hook.URL,
			"event", eventType, "status", status, "error", lastErr, "attempts", attempts)
	}
}

func (d *Dispatcher) post(ctx context.Context, hook store.Webhook, eventType string, body []byte) (int, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, hook.URL, bytes.NewReader(body))
	if err != nil {
		return 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TaskHat-Webhooks/1.0")
	req.Header.Set("X-TaskHat-Event", eventType)
	if hook.Secret != "" {
		mac := hmac.New(sha256.New, []byte(hook.Secret))
		mac.Write(body)
		req.Header.Set("X-TaskHat-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return resp.StatusCode, http.StatusText(resp.StatusCode)
	}
	return resp.StatusCode, ""
}
