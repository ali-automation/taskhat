package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// --- Features (space settings > Features: per-space tab toggles) ---

func (s *Store) SetProjectFeatures(ctx context.Context, key string, features map[string]bool) error {
	b, _ := json.Marshal(features)
	tag, err := s.pool.Exec(ctx,
		`UPDATE projects SET features = $2, updated_at = now() WHERE key = $1`, key, b)
	if err != nil {
		return fmt.Errorf("set features: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Components (space settings > Components, Jira parity) ---

type Component struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	DefaultAssignee *User   `json:"defaultAssignee"`
	IssueCount      int64   `json:"issueCount"`
}

var ErrComponentExists = errors.New("component exists")

func (s *Store) ListProjectComponents(ctx context.Context, projectID string) ([]Component, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.name, c.description, u.id, u.email, u.display_name, u.avatar_url, u.is_active,
		  (SELECT count(*) FROM issue_components ic WHERE ic.component_id = c.id)
		FROM components c
		LEFT JOIN users u ON u.id = c.default_assignee_id
		WHERE c.project_id = $1 ORDER BY lower(c.name)`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list components: %w", err)
	}
	defer rows.Close()
	out := []Component{}
	for rows.Next() {
		var c Component
		var uid, email, name, avatar *string
		var active *bool
		if err := rows.Scan(&c.ID, &c.Name, &c.Description, &uid, &email, &name, &avatar, &active, &c.IssueCount); err != nil {
			return nil, err
		}
		if uid != nil {
			c.DefaultAssignee = &User{ID: *uid, Email: *email, DisplayName: *name, AvatarURL: avatar, IsActive: active != nil && *active}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) CreateComponent(ctx context.Context, projectID, name, description string, defaultAssigneeID *string) (string, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM components WHERE project_id = $1 AND lower(name) = lower($2))`,
		projectID, name).Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return "", ErrComponentExists
	}
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO components (project_id, name, description, default_assignee_id)
		VALUES ($1, $2, $3, $4) RETURNING id`,
		projectID, name, description, defaultAssigneeID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create component: %w", err)
	}
	return id, nil
}

func (s *Store) UpdateComponent(ctx context.Context, projectID, id, name, description string, defaultAssigneeID *string) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM components
		  WHERE project_id = $1 AND lower(name) = lower($2) AND id <> $3)`,
		projectID, name, id).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return ErrComponentExists
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE components SET name = $3, description = $4, default_assignee_id = $5
		WHERE project_id = $1 AND id = $2`,
		projectID, id, name, description, defaultAssigneeID)
	if err != nil {
		return fmt.Errorf("update component: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteComponent removes the component and its issue associations (Jira's
// "delete and remove from work items" path).
func (s *Store) DeleteComponent(ctx context.Context, projectID, id string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM components WHERE project_id = $1 AND id = $2`, projectID, id)
	if err != nil {
		return fmt.Errorf("delete component: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Space email audit (space settings > Notifications > Space email audit) ---

type EmailAuditEntry struct {
	At        time.Time `json:"at"`
	Recipient string    `json:"recipient"`
	Kind      string    `json:"kind"`
	IssueKey  string    `json:"issueKey"`
	Subject   string    `json:"subject"`
}

// AuditNotificationEmail records a sent notification email (best-effort).
func (s *Store) AuditNotificationEmail(ctx context.Context, projectKey, recipient, kind, issueKey, subject string) {
	details, _ := json.Marshal(map[string]string{
		"projectKey": projectKey, "recipient": recipient, "kind": kind,
		"issueKey": issueKey, "subject": subject,
	})
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO audit_log (actor_id, action, target, details)
		VALUES (NULL, 'mail.notification', $1, $2)`, recipient, details)
}

func (s *Store) SpaceEmailAudit(ctx context.Context, projectKey string, limit int) ([]EmailAuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT created_at, details FROM audit_log
		WHERE action = 'mail.notification' AND details ->> 'projectKey' = $1
		ORDER BY created_at DESC LIMIT $2`, projectKey, limit)
	if err != nil {
		return nil, fmt.Errorf("email audit: %w", err)
	}
	defer rows.Close()
	out := []EmailAuditEntry{}
	for rows.Next() {
		var at time.Time
		var raw []byte
		if err := rows.Scan(&at, &raw); err != nil {
			return nil, err
		}
		var d map[string]string
		_ = json.Unmarshal(raw, &d)
		out = append(out, EmailAuditEntry{At: at, Recipient: d["recipient"], Kind: d["kind"], IssueKey: d["issueKey"], Subject: d["subject"]})
	}
	return out, rows.Err()
}
