// Package notify turns domain events into notifications: rows for the in-app
// feed, frames on each recipient's realtime channel, and (best-effort) email.
package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/config"
	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/mailer"
	"github.com/ali-automation/taskhat/backend/internal/realtime"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

type Notifier struct {
	cfg config.Config
	st  *store.Store
	hub *realtime.Hub
	log *slog.Logger
}

func New(cfg config.Config, st *store.Store, hub *realtime.Hub, log *slog.Logger) *Notifier {
	return &Notifier{cfg: cfg, st: st, hub: hub, log: log}
}

type commentEvent struct {
	Issue          store.Issue   `json:"issue"`
	Comment        store.Comment `json:"comment"`
	MentionUserIDs []string      `json:"mentionUserIds"`
}

// payloadStored is what the UI renders from the notifications feed.
// Wiki notifications carry a page reference instead of an issue key.
type payloadStored struct {
	IssueKey   string `json:"issueKey"`
	Summary    string `json:"summary"`
	Preview    string `json:"preview,omitempty"`
	WikiPageID string `json:"wikiPageId,omitempty"`
	SpaceKey   string `json:"spaceKey,omitempty"`
}

type wikiCommentEvent struct {
	Page           store.WikiPage `json:"page"`
	Comment        store.Comment  `json:"comment"`
	MentionUserIDs []string       `json:"mentionUserIds"`
}

func (n *Notifier) Handle(e events.Event) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var issue store.Issue
	kind := ""
	preview := ""
	mentions := map[string]bool{}

	switch e.Type {
	case "issue.created", "issue.updated", "issue.transitioned":
		if err := json.Unmarshal(e.Payload, &issue); err != nil {
			n.log.Error("bad issue payload", "type", e.Type, "error", err)
			return nil // malformed: don't requeue forever
		}
		kind = strings.TrimPrefix(e.Type, "issue.")
		if e.Type == "issue.transitioned" {
			preview = issue.Status.Name
		}
	case "comment.added":
		var ce commentEvent
		if err := json.Unmarshal(e.Payload, &ce); err != nil {
			n.log.Error("bad comment payload", "error", err)
			return nil
		}
		issue = ce.Issue
		kind = "comment"
		preview = truncate(ce.Comment.Body, 140)
		for _, id := range ce.MentionUserIDs {
			mentions[id] = true
		}
	case "wiki.page_updated", "wiki.comment_added":
		return n.handleWiki(ctx, e)
	default:
		return nil
	}

	recipients, err := n.st.WatcherIDs(ctx, issue.ID)
	if err != nil {
		return fmt.Errorf("recipients: %w", err)
	}
	seen := map[string]bool{}
	for _, id := range recipients {
		seen[id] = true
	}
	for id := range mentions {
		if !seen[id] {
			recipients = append(recipients, id)
		}
	}

	stored := payloadStored{IssueKey: issue.Key, Summary: issue.Summary, Preview: preview}
	for _, userID := range recipients {
		if userID == e.ActorID {
			continue
		}
		k := kind
		if mentions[userID] {
			k = "mention"
		}
		// Stage 10: the recipient's personal notification matrix decides both
		// channels; missing prefs default to on.
		prefs, err := n.st.GetUserNotifyPrefs(ctx, userID)
		if err != nil {
			n.log.Error("user notify prefs", "user", userID, "error", err)
		}
		if !prefs.InappAllowed(k) {
			continue
		}
		if err := n.st.CreateNotification(ctx, userID, issue.ID, e.ActorID, k, stored); err != nil {
			n.log.Error("create notification", "user", userID, "error", err)
			continue
		}
		if err := n.hub.Publish(ctx, "user:"+userID, "notification.new",
			map[string]any{"kind": k, "issueKey": issue.Key}); err != nil {
			n.log.Error("ws notification", "user", userID, "error", err)
		}
		if prefs.EmailAllowed(k) {
			n.email(ctx, userID, e.ActorID, k, issue, preview)
		}
	}
	return nil
}

// email is best-effort; SMTP settings in the DB override the environment.
// Space notification settings gate email per event kind (mentions always
// send); the in-app notification is created regardless.
// smtp resolves outgoing-mail settings: DB values override environment.
func (n *Notifier) smtp(ctx context.Context) mailer.Config {
	cfg := mailer.Config{
		Addr: n.cfg.SMTPAddr, From: n.cfg.SMTPFrom,
		Username: n.cfg.SMTPUsername, Password: n.cfg.SMTPPassword,
	}
	if settings, err := n.st.SiteSettings(ctx); err == nil {
		if v := settings["smtp_addr"]; v != "" {
			cfg.Addr = v
		}
		if v := settings["smtp_from"]; v != "" {
			cfg.From = v
		}
		if v := settings["smtp_username"]; v != "" {
			cfg.Username = v
			cfg.Password = settings["smtp_password"]
		}
	}
	return cfg
}

func (n *Notifier) email(ctx context.Context, userID, actorID, kind string, issue store.Issue, preview string) {
	if kind != "mention" {
		if prefs, err := n.st.NotifyPrefsByProjectKey(ctx, issue.ProjectKey); err == nil {
			if enabled, set := prefs[kind]; set && !enabled {
				return
			}
		}
	}
	smtp := n.smtp(ctx)
	if !smtp.Enabled() {
		return
	}
	user, err := n.st.GetUserByID(ctx, userID)
	if err != nil {
		return
	}
	actor, err := n.st.GetUserByID(ctx, actorID)
	if err != nil {
		return
	}

	var action string
	switch kind {
	case "created":
		action = "created"
	case "transitioned":
		action = "moved to " + preview
	case "comment":
		action = "commented on"
	case "mention":
		action = "mentioned you on"
	default:
		action = "updated"
	}
	subject := fmt.Sprintf("[TaskHat] (%s) %s", issue.Key, issue.Summary)
	link := fmt.Sprintf("%s/browse/%s", n.cfg.BaseURL, issue.Key)
	body := fmt.Sprintf("%s %s %s: %s\r\n\r\n%s\r\n\r\nView it: %s\r\n",
		actor.DisplayName, action, issue.Key, issue.Summary, preview, link)

	if err := mailer.Send(smtp, user.Email, subject, body); err != nil {
		n.log.Error("send email", "to", user.Email, "error", err)
		return
	}
	// Space email audit (space settings > Notifications > Space email audit).
	n.st.AuditNotificationEmail(ctx, issue.ProjectKey, user.Email, kind, issue.Key, subject)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// handleWiki notifies page watchers (and mentioned users) about DocHat events,
// reusing the personal notification matrix: page edits count as "updated",
// comments as "comment"/"mention".
func (n *Notifier) handleWiki(ctx context.Context, e events.Event) error {
	var page store.WikiPage
	kind := "updated"
	preview := ""
	mentions := map[string]bool{}

	switch e.Type {
	case "wiki.page_updated":
		if err := json.Unmarshal(e.Payload, &page); err != nil {
			n.log.Error("bad wiki page payload", "error", err)
			return nil
		}
	case "wiki.comment_added":
		var ce wikiCommentEvent
		if err := json.Unmarshal(e.Payload, &ce); err != nil {
			n.log.Error("bad wiki comment payload", "error", err)
			return nil
		}
		page = ce.Page
		kind = "comment"
		preview = truncate(ce.Comment.Body, 140)
		for _, id := range ce.MentionUserIDs {
			mentions[id] = true
		}
	}

	recipients, err := n.st.WikiWatcherIDs(ctx, page.ID)
	if err != nil {
		return fmt.Errorf("wiki recipients: %w", err)
	}
	seen := map[string]bool{}
	for _, id := range recipients {
		seen[id] = true
	}
	for id := range mentions {
		if !seen[id] {
			recipients = append(recipients, id)
		}
	}

	stored := payloadStored{Summary: page.Title, Preview: preview, WikiPageID: page.ID, SpaceKey: page.SpaceKey}
	link := fmt.Sprintf("%s/wiki/spaces/%s/pages/%s", n.cfg.BaseURL, page.SpaceKey, page.ID)
	for _, userID := range recipients {
		if userID == e.ActorID {
			continue
		}
		k := kind
		if mentions[userID] {
			k = "mention"
		}
		prefs, err := n.st.GetUserNotifyPrefs(ctx, userID)
		if err != nil {
			n.log.Error("user notify prefs", "user", userID, "error", err)
		}
		if !prefs.InappAllowed(k) {
			continue
		}
		if err := n.st.CreateWikiNotification(ctx, userID, e.ActorID, k, stored); err != nil {
			n.log.Error("create wiki notification", "user", userID, "error", err)
			continue
		}
		if err := n.hub.Publish(ctx, "user:"+userID, "notification.new",
			map[string]any{"kind": k, "wikiPageId": page.ID}); err != nil {
			n.log.Error("ws notification", "user", userID, "error", err)
		}
		if prefs.EmailAllowed(k) {
			n.emailWiki(ctx, userID, e.ActorID, k, page, preview, link)
		}
	}
	return nil
}

func (n *Notifier) emailWiki(ctx context.Context, userID, actorID, kind string, page store.WikiPage, preview, link string) {
	smtp := n.smtp(ctx)
	if !smtp.Enabled() {
		return
	}
	user, err := n.st.GetUserByID(ctx, userID)
	if err != nil {
		return
	}
	actor, err := n.st.GetUserByID(ctx, actorID)
	if err != nil {
		return
	}
	action := "updated"
	switch kind {
	case "comment":
		action = "commented on"
	case "mention":
		action = "mentioned you on"
	}
	subject := fmt.Sprintf("[DocHat] %s", page.Title)
	body := fmt.Sprintf("%s %s \"%s\" (%s)\r\n\r\n%s\r\n\r\nView it: %s\r\n",
		actor.DisplayName, action, page.Title, page.SpaceName, preview, link)
	if err := mailer.Send(smtp, user.Email, subject, body); err != nil {
		n.log.Error("send wiki email", "to", user.Email, "error", err)
	}
}
