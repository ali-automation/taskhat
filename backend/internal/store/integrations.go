package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- webhooks ----

type Webhook struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	URL        string    `json:"url"`
	Secret     string    `json:"-"` // never serialized; UI shows hasSecret
	HasSecret  bool      `json:"hasSecret"`
	Events     []string  `json:"events"`
	ProjectID  *string   `json:"projectId"`
	ProjectKey *string   `json:"projectKey"`
	IsEnabled  bool      `json:"isEnabled"`
	CreatedAt  time.Time `json:"createdAt"`
}

const webhookSelect = `
SELECT w.id, w.name, w.url, w.secret, w.events, w.project_id, p.key, w.is_enabled, w.created_at
FROM webhooks w
LEFT JOIN projects p ON p.id = w.project_id
`

func scanWebhook(row pgx.Row) (Webhook, error) {
	var w Webhook
	err := row.Scan(&w.ID, &w.Name, &w.URL, &w.Secret, &w.Events, &w.ProjectID, &w.ProjectKey, &w.IsEnabled, &w.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Webhook{}, ErrNotFound
	}
	w.HasSecret = w.Secret != ""
	return w, err
}

func (s *Store) collectWebhooks(rows pgx.Rows, err error) ([]Webhook, error) {
	if err != nil {
		return nil, fmt.Errorf("webhooks: %w", err)
	}
	defer rows.Close()
	hooks := []Webhook{}
	for rows.Next() {
		w, err := scanWebhook(rows)
		if err != nil {
			return nil, err
		}
		hooks = append(hooks, w)
	}
	return hooks, rows.Err()
}

func (s *Store) ListWebhooks(ctx context.Context) ([]Webhook, error) {
	return s.collectWebhooks(s.pool.Query(ctx, webhookSelect+` ORDER BY w.created_at`))
}

// WebhooksForEvent returns enabled webhooks whose filter matches the event and
// (when scoped to a space) the project key.
func (s *Store) WebhooksForEvent(ctx context.Context, eventType, projectKey string) ([]Webhook, error) {
	return s.collectWebhooks(s.pool.Query(ctx, webhookSelect+`
		WHERE w.is_enabled
		  AND ('*' = ANY(w.events) OR $1 = ANY(w.events))
		  AND (w.project_id IS NULL OR p.key = $2)`, eventType, projectKey))
}

func (s *Store) CreateWebhook(ctx context.Context, name, url, secret string, events []string, projectID *string, createdBy string) (Webhook, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO webhooks (name, url, secret, events, project_id, created_by)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		name, url, secret, events, projectID, createdBy).Scan(&id)
	if err != nil {
		return Webhook{}, fmt.Errorf("create webhook: %w", err)
	}
	return scanWebhook(s.pool.QueryRow(ctx, webhookSelect+` WHERE w.id = $1`, id))
}

// UpdateWebhook updates everything but the secret unless newSecret is non-nil.
func (s *Store) UpdateWebhook(ctx context.Context, id, name, url string, events []string, projectID *string, enabled bool, newSecret *string) (Webhook, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE webhooks SET name = $2, url = $3, events = $4, project_id = $5, is_enabled = $6,
			secret = COALESCE($7, secret)
		WHERE id = $1`,
		id, name, url, events, projectID, enabled, newSecret)
	if err != nil {
		return Webhook{}, fmt.Errorf("update webhook: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Webhook{}, ErrNotFound
	}
	return scanWebhook(s.pool.QueryRow(ctx, webhookSelect+` WHERE w.id = $1`, id))
}

func (s *Store) DeleteWebhook(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM webhooks WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete webhook: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- webhook deliveries ----

type WebhookDelivery struct {
	ID        string    `json:"id"`
	EventType string    `json:"eventType"`
	Status    int       `json:"status"` // HTTP status; 0 = network error
	Error     string    `json:"error"`
	Attempts  int       `json:"attempts"`
	Summary   string    `json:"summary"`
	CreatedAt time.Time `json:"createdAt"`
}

// RecordDelivery logs an attempt outcome and prunes old rows (keep 200).
func (s *Store) RecordDelivery(ctx context.Context, webhookID, eventType string, status int, errMsg string, attempts int, summary string) {
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO webhook_deliveries (webhook_id, event_type, status, error, attempts, summary)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		webhookID, eventType, status, errMsg, attempts, summary)
	_, _ = s.pool.Exec(ctx, `
		DELETE FROM webhook_deliveries WHERE webhook_id = $1 AND id NOT IN (
			SELECT id FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 200)`,
		webhookID)
}

func (s *Store) ListDeliveries(ctx context.Context, webhookID string, limit int) ([]WebhookDelivery, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, event_type, status, error, attempts, summary, created_at
		FROM webhook_deliveries WHERE webhook_id = $1
		ORDER BY created_at DESC LIMIT $2`, webhookID, limit)
	if err != nil {
		return nil, fmt.Errorf("deliveries: %w", err)
	}
	defer rows.Close()
	out := []WebhookDelivery{}
	for rows.Next() {
		var d WebhookDelivery
		if err := rows.Scan(&d.ID, &d.EventType, &d.Status, &d.Error, &d.Attempts, &d.Summary, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ---- personal API tokens ----

type APIToken struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Prefix     string     `json:"prefix"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateAPIToken mints a token; the plaintext is returned exactly once.
func (s *Store) CreateAPIToken(ctx context.Context, userID, label string) (APIToken, string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return APIToken{}, "", fmt.Errorf("token entropy: %w", err)
	}
	token := "tk_" + hex.EncodeToString(buf)
	prefix := token[:11] // tk_ + 8 chars
	var t APIToken
	err := s.pool.QueryRow(ctx, `
		INSERT INTO api_tokens (user_id, label, token_hash, prefix)
		VALUES ($1, $2, $3, $4)
		RETURNING id, label, prefix, last_used_at, created_at`,
		userID, label, hashToken(token), prefix).
		Scan(&t.ID, &t.Label, &t.Prefix, &t.LastUsedAt, &t.CreatedAt)
	if err != nil {
		return APIToken{}, "", fmt.Errorf("create token: %w", err)
	}
	return t, token, nil
}

func (s *Store) ListAPITokens(ctx context.Context, userID string) ([]APIToken, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, label, prefix, last_used_at, created_at
		FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("tokens: %w", err)
	}
	defer rows.Close()
	tokens := []APIToken{}
	for rows.Next() {
		var t APIToken
		if err := rows.Scan(&t.ID, &t.Label, &t.Prefix, &t.LastUsedAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, rows.Err()
}

func (s *Store) RevokeAPIToken(ctx context.Context, userID, id string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM api_tokens WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UserForAPIToken resolves a bearer tk_ token to its (active) owner and stamps
// last-used.
func (s *Store) UserForAPIToken(ctx context.Context, token string) (string, error) {
	var userID string
	var active bool
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.is_active FROM api_tokens t JOIN users u ON u.id = t.user_id
		WHERE t.token_hash = $1`, hashToken(token)).Scan(&userID, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if !active {
		return "", ErrNotFound
	}
	_, _ = s.pool.Exec(ctx,
		`UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1`, hashToken(token))
	return userID, nil
}
