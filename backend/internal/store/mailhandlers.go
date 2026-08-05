package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage 25: incoming mail → work items ----

type IMAPConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	TLS      bool   `json:"tls"`
	Username string `json:"username"`
	Password string `json:"password"`
	Folder   string `json:"folder"`
}

type MailHandler struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	ProjectID      string     `json:"-"`
	ProjectKey     string     `json:"projectKey"`
	ProjectName    string     `json:"projectName"`
	IssueType      string     `json:"issueType"`
	Mode           string     `json:"mode"` // webhook | imap
	Token          *string    `json:"token,omitempty"`
	IMAP           IMAPConfig `json:"imap"`
	AllowReplies   bool       `json:"allowReplies"`
	IsEnabled      bool       `json:"isEnabled"`
	CreatedBy      *string    `json:"-"`
	LastPolledAt   *time.Time `json:"lastPolledAt"`
	LastError      string     `json:"lastError"`
	ProcessedCount int        `json:"processedCount"`
	CreatedAt      time.Time  `json:"createdAt"`
}

const mailHandlerSelect = `
SELECT h.id, h.name, h.project_id, p.key, p.name, h.issue_type, h.mode, h.token,
       h.imap_config, h.allow_replies, h.is_enabled, h.created_by,
       h.last_polled_at, h.last_error, h.processed_count, h.created_at
FROM mail_handlers h JOIN projects p ON p.id = h.project_id
`

func scanMailHandler(row pgx.Row) (MailHandler, error) {
	var h MailHandler
	var imapRaw []byte
	err := row.Scan(&h.ID, &h.Name, &h.ProjectID, &h.ProjectKey, &h.ProjectName, &h.IssueType,
		&h.Mode, &h.Token, &imapRaw, &h.AllowReplies, &h.IsEnabled, &h.CreatedBy,
		&h.LastPolledAt, &h.LastError, &h.ProcessedCount, &h.CreatedAt)
	if err != nil {
		return h, err
	}
	_ = json.Unmarshal(imapRaw, &h.IMAP)
	return h, nil
}

func (s *Store) ListMailHandlers(ctx context.Context) ([]MailHandler, error) {
	rows, err := s.pool.Query(ctx, mailHandlerSelect+`ORDER BY h.created_at`)
	if err != nil {
		return nil, fmt.Errorf("list mail handlers: %w", err)
	}
	defer rows.Close()
	handlers := []MailHandler{}
	for rows.Next() {
		h, err := scanMailHandler(rows)
		if err != nil {
			return nil, err
		}
		handlers = append(handlers, h)
	}
	return handlers, rows.Err()
}

func (s *Store) GetMailHandler(ctx context.Context, id string) (MailHandler, error) {
	h, err := scanMailHandler(s.pool.QueryRow(ctx, mailHandlerSelect+`WHERE h.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return h, ErrNotFound
	}
	return h, err
}

// MailHandlerByToken resolves an enabled webhook handler for the public endpoint.
func (s *Store) MailHandlerByToken(ctx context.Context, token string) (MailHandler, error) {
	h, err := scanMailHandler(s.pool.QueryRow(ctx,
		mailHandlerSelect+`WHERE h.token = $1 AND h.is_enabled AND h.mode = 'webhook'`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return h, ErrNotFound
	}
	return h, err
}

func (s *Store) CreateMailHandler(ctx context.Context, name, projectID, issueType, mode string,
	token *string, imapCfg IMAPConfig, allowReplies bool, createdBy string) (string, error) {
	imapRaw, _ := json.Marshal(imapCfg)
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO mail_handlers (name, project_id, issue_type, mode, token, imap_config, allow_replies, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		name, projectID, issueType, mode, token, imapRaw, allowReplies, createdBy).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create mail handler: %w", err)
	}
	return id, nil
}

func (s *Store) UpdateMailHandler(ctx context.Context, id, name, projectID, issueType string,
	imapCfg IMAPConfig, allowReplies, isEnabled bool) error {
	imapRaw, _ := json.Marshal(imapCfg)
	tag, err := s.pool.Exec(ctx, `
		UPDATE mail_handlers
		SET name = $2, project_id = $3, issue_type = $4, imap_config = $5, allow_replies = $6, is_enabled = $7
		WHERE id = $1`, id, name, projectID, issueType, imapRaw, allowReplies, isEnabled)
	if err != nil {
		return fmt.Errorf("update mail handler: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteMailHandler(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mail_handlers WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete mail handler: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RecordMailResult stamps a poll/delivery outcome on the handler row.
func (s *Store) RecordMailResult(ctx context.Context, id string, processed int, lastError string) {
	_, _ = s.pool.Exec(ctx, `
		UPDATE mail_handlers
		SET last_polled_at = now(), last_error = $3, processed_count = processed_count + $2
		WHERE id = $1`, id, processed, lastError)
}

// UserIDByEmail maps a sender to an active account (mail-in attribution).
func (s *Store) UserIDByEmail(ctx context.Context, email string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM users WHERE email = $1::citext AND is_active`, email).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}
