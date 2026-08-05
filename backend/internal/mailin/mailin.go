// Package mailin turns incoming email into work items or comments —
// TaskHat's version of Jira's "create issue or comment from email" handler.
// Mail arrives either through the public inbound webhook or the IMAP poller;
// both feed Process.
package mailin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

const (
	MaxAttachmentSize = 10 << 20 // 10 MiB per file
	MaxAttachments    = 8
	maxBodyChars      = 32_000
	maxSummaryChars   = 250
)

type Attachment struct {
	Filename    string
	ContentType string
	Data        []byte
}

type Mail struct {
	From        string
	Subject     string
	TextBody    string
	Attachments []Attachment
}

// commentEvent mirrors httpapi.CommentEvent so notifications/automation
// consume mail comments exactly like UI comments.
type commentEvent struct {
	Issue   store.Issue   `json:"issue"`
	Comment store.Comment `json:"comment"`
}

var issueKeyRe = regexp.MustCompile(`\b([A-Z][A-Z0-9]{1,9})-(\d{1,9})\b`)
var rePrefixRe = regexp.MustCompile(`(?i)^\s*((re|fwd|fw)\s*:\s*)+`)

type Processor struct {
	St    *store.Store
	Blobs storage.Blob
	Pub   *events.Publisher
	Log   *slog.Logger
}

func New(st *store.Store, blobs storage.Blob, pub *events.Publisher, log *slog.Logger) *Processor {
	return &Processor{St: st, Blobs: blobs, Pub: pub, Log: log}
}

func (p *Processor) publish(ctx context.Context, eventType, actorID string, payload any) {
	if p.Pub == nil {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if err := p.Pub.Publish(ctx, events.Event{
		Type: eventType, ActorID: actorID, OccurredAt: time.Now().UTC(), Payload: body,
	}); err != nil {
		p.Log.Error("mailin publish", "type", eventType, "error", err)
	}
}

// Process applies one mail to the handler's space: an issue key in the
// subject makes it a comment (Jira's reply threading), anything else
// becomes a new work item. Returns a short human-readable result.
func (p *Processor) Process(ctx context.Context, h store.MailHandler, m Mail) (string, error) {
	from := strings.ToLower(strings.TrimSpace(m.From))
	actorID, err := p.St.UserIDByEmail(ctx, from)
	known := err == nil
	if !known {
		if h.CreatedBy == nil {
			return "", errors.New("sender unknown and the handler has no owner to fall back to")
		}
		actorID = *h.CreatedBy
	}

	body := strings.TrimSpace(m.TextBody)
	if len(body) > maxBodyChars {
		body = body[:maxBodyChars] + "\n…"
	}
	if !known && from != "" {
		body = "From: " + from + "\n\n" + body
	}

	// Reply threading: subject carries an existing issue key → comment.
	if h.AllowReplies {
		if match := issueKeyRe.FindStringSubmatch(strings.ToUpper(m.Subject)); match != nil {
			number, _ := strconv.ParseInt(match[2], 10, 64)
			issue, err := p.St.GetIssueByKey(ctx, match[1], number)
			if err == nil {
				if body == "" {
					body = "(empty email body)"
				}
				comment, err := p.St.CreateComment(ctx, issue.ID, actorID, body)
				if err != nil {
					return "", fmt.Errorf("comment from mail: %w", err)
				}
				n := p.storeAttachments(ctx, issue.ID, actorID, m.Attachments)
				p.publish(ctx, "comment.added", actorID, commentEvent{Issue: issue, Comment: comment})
				return fmt.Sprintf("commented on %s (%d attachments)", issue.Key, n), nil
			}
		}
	}

	summary := strings.TrimSpace(rePrefixRe.ReplaceAllString(m.Subject, ""))
	if summary == "" {
		summary = "(no subject)"
	}
	if len(summary) > maxSummaryChars {
		summary = summary[:maxSummaryChars] + "…"
	}
	issue, err := p.St.CreateIssue(ctx, store.NewIssue{
		ProjectID:   h.ProjectID,
		Type:        h.IssueType,
		Summary:     summary,
		Description: body,
		Priority:    "medium",
		ReporterID:  actorID,
	})
	if err != nil {
		return "", fmt.Errorf("issue from mail: %w", err)
	}
	n := p.storeAttachments(ctx, issue.ID, actorID, m.Attachments)
	p.publish(ctx, "issue.created", actorID, issue)
	return fmt.Sprintf("created %s (%d attachments)", issue.Key, n), nil
}

func (p *Processor) storeAttachments(ctx context.Context, issueID, actorID string, atts []Attachment) int {
	stored := 0
	for i, a := range atts {
		if i >= MaxAttachments || len(a.Data) == 0 || len(a.Data) > MaxAttachmentSize {
			continue
		}
		name := strings.TrimSpace(a.Filename)
		if name == "" {
			name = "attachment"
		}
		mime := a.ContentType
		if mime == "" {
			mime = "application/octet-stream"
		}
		key := uuid.NewString()
		if err := p.Blobs.Put(ctx, key, bytes.NewReader(a.Data), int64(len(a.Data)), mime); err != nil {
			p.Log.Error("mailin blob", "error", err)
			continue
		}
		if _, err := p.St.CreateAttachment(ctx, issueID, actorID, name, mime, int64(len(a.Data)), key); err != nil {
			p.Log.Error("mailin attachment", "error", err)
			_ = p.Blobs.Delete(ctx, key)
			continue
		}
		stored++
	}
	return stored
}
