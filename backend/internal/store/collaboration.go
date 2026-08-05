package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type Comment struct {
	ID        string          `json:"id"`
	Author    User            `json:"author"`
	Body      string          `json:"body"`
	BodyDoc   json.RawMessage `json:"bodyDoc"` // TipTap JSON; nil = legacy plain text
	EditedAt  *time.Time      `json:"editedAt"`
	CreatedAt time.Time       `json:"createdAt"`
}

// nullableJSON maps empty docs to SQL NULL.
func nullableJSON(doc []byte) any {
	if len(doc) == 0 {
		return nil
	}
	return json.RawMessage(doc)
}

const commentSelect = `
SELECT c.id, c.body, c.body_doc, c.edited_at, c.created_at,
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM comments c JOIN users u ON u.id = c.author_id
`

func scanComment(row pgx.Row) (Comment, error) {
	var c Comment
	err := row.Scan(&c.ID, &c.Body, &c.BodyDoc, &c.EditedAt, &c.CreatedAt,
		&c.Author.ID, &c.Author.Email, &c.Author.DisplayName, &c.Author.AvatarURL,
		&c.Author.IsActive, &c.Author.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, ErrNotFound
	}
	return c, err
}

// CreateComment adds the comment, records the changelog event, and makes the
// author a watcher (Jira behavior).
func (s *Store) CreateComment(ctx context.Context, issueID, authorID, body string) (Comment, error) {
	return s.CreateCommentDoc(ctx, issueID, authorID, body, nil)
}

// CreateCommentDoc stores rich text (TipTap JSON) alongside the plain mirror.
func (s *Store) CreateCommentDoc(ctx context.Context, issueID, authorID, body string, doc []byte) (Comment, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Comment{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var id string
	if err := tx.QueryRow(ctx,
		`INSERT INTO comments (issue_id, author_id, body, body_doc) VALUES ($1, $2, $3, $4) RETURNING id`,
		issueID, authorID, body, nullableJSON(doc)).Scan(&id); err != nil {
		return Comment{}, fmt.Errorf("insert comment: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO issue_events (issue_id, actor_id, field, new_value) VALUES ($1, $2, 'comment', $3)`,
		issueID, authorID, jsonVal(truncate(body, 120))); err != nil {
		return Comment{}, fmt.Errorf("record event: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		issueID, authorID); err != nil {
		return Comment{}, fmt.Errorf("auto-watch: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Comment{}, fmt.Errorf("commit: %w", err)
	}
	return scanComment(s.pool.QueryRow(ctx, commentSelect+` WHERE c.id = $1`, id))
}

func (s *Store) ListComments(ctx context.Context, issueID string) ([]Comment, error) {
	rows, err := s.pool.Query(ctx, commentSelect+` WHERE c.issue_id = $1 ORDER BY c.created_at`, issueID)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	defer rows.Close()
	comments := []Comment{}
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// GetCommentAuthor returns the author id, for permission checks.
func (s *Store) GetCommentAuthor(ctx context.Context, issueID, commentID string) (string, error) {
	var authorID string
	err := s.pool.QueryRow(ctx,
		`SELECT author_id FROM comments WHERE id = $1 AND issue_id = $2`, commentID, issueID).Scan(&authorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return authorID, err
}

func (s *Store) UpdateComment(ctx context.Context, commentID, body string) (Comment, error) {
	return s.UpdateCommentDoc(ctx, commentID, body, nil)
}

func (s *Store) UpdateCommentDoc(ctx context.Context, commentID, body string, doc []byte) (Comment, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE comments SET body = $2, body_doc = $3, edited_at = now() WHERE id = $1`,
		commentID, body, nullableJSON(doc))
	if err != nil {
		return Comment{}, fmt.Errorf("update comment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Comment{}, ErrNotFound
	}
	return scanComment(s.pool.QueryRow(ctx, commentSelect+` WHERE c.id = $1`, commentID))
}

func (s *Store) DeleteComment(ctx context.Context, commentID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM comments WHERE id = $1`, commentID)
	if err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type Attachment struct {
	ID         string    `json:"id"`
	Filename   string    `json:"filename"`
	Mime       string    `json:"mime"`
	SizeBytes  int64     `json:"sizeBytes"`
	StorageKey string    `json:"-"`
	IssueID    string    `json:"-"`
	Uploader   User      `json:"uploader"`
	CreatedAt  time.Time `json:"createdAt"`
}

const attachmentSelect = `
SELECT a.id, a.filename, a.mime, a.size_bytes, a.storage_key, a.issue_id, a.created_at,
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM attachments a JOIN users u ON u.id = a.uploader_id
`

func scanAttachment(row pgx.Row) (Attachment, error) {
	var a Attachment
	err := row.Scan(&a.ID, &a.Filename, &a.Mime, &a.SizeBytes, &a.StorageKey, &a.IssueID, &a.CreatedAt,
		&a.Uploader.ID, &a.Uploader.Email, &a.Uploader.DisplayName, &a.Uploader.AvatarURL,
		&a.Uploader.IsActive, &a.Uploader.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Attachment{}, ErrNotFound
	}
	return a, err
}

func (s *Store) CreateAttachment(ctx context.Context, issueID, uploaderID, filename, mime string, size int64, storageKey string) (Attachment, error) {
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO attachments (issue_id, uploader_id, filename, mime, size_bytes, storage_key)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		issueID, uploaderID, filename, mime, size, storageKey).Scan(&id); err != nil {
		return Attachment{}, fmt.Errorf("insert attachment: %w", err)
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO issue_events (issue_id, actor_id, field, new_value) VALUES ($1, $2, 'attachment', $3)`,
		issueID, uploaderID, jsonVal(filename)); err != nil {
		return Attachment{}, fmt.Errorf("record event: %w", err)
	}
	return scanAttachment(s.pool.QueryRow(ctx, attachmentSelect+` WHERE a.id = $1`, id))
}

func (s *Store) ListAttachments(ctx context.Context, issueID string) ([]Attachment, error) {
	rows, err := s.pool.Query(ctx, attachmentSelect+` WHERE a.issue_id = $1 ORDER BY a.created_at`, issueID)
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	defer rows.Close()
	attachments := []Attachment{}
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return nil, err
		}
		attachments = append(attachments, a)
	}
	return attachments, rows.Err()
}

func (s *Store) GetAttachment(ctx context.Context, id string) (Attachment, error) {
	return scanAttachment(s.pool.QueryRow(ctx, attachmentSelect+` WHERE a.id = $1`, id))
}

func (s *Store) DeleteAttachment(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM attachments WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete attachment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListWatchers(ctx context.Context, issueID string) ([]User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM users u JOIN watchers w ON w.user_id = u.id
		WHERE w.issue_id = $1 ORDER BY u.display_name`, issueID)
	if err != nil {
		return nil, fmt.Errorf("list watchers: %w", err)
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Store) AddWatcher(ctx context.Context, issueID, userID string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, issueID, userID)
	return err
}

func (s *Store) RemoveWatcher(ctx context.Context, issueID, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM watchers WHERE issue_id = $1 AND user_id = $2`, issueID, userID)
	return err
}

// WatcherIDs returns watcher user ids plus the assignee — the notification
// recipient set (before excluding the actor).
func (s *Store) WatcherIDs(ctx context.Context, issueID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT user_id FROM watchers WHERE issue_id = $1
		UNION
		SELECT assignee_id FROM issues WHERE id = $1 AND assignee_id IS NOT NULL`, issueID)
	if err != nil {
		return nil, fmt.Errorf("watcher ids: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

type Notification struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	Actor     User            `json:"actor"`
	IssueID   *string         `json:"-"`
	Payload   json.RawMessage `json:"payload"`
	ReadAt    *time.Time      `json:"readAt"`
	CreatedAt time.Time       `json:"createdAt"`
}

func (s *Store) CreateNotification(ctx context.Context, userID, issueID, actorID, kind string, payload any) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notifications (user_id, issue_id, actor_id, kind, payload)
		VALUES ($1, $2, $3, $4, $5)`, userID, issueID, actorID, kind, jsonVal(payload))
	if err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return nil
}

func (s *Store) ListNotifications(ctx context.Context, userID string, limit int) ([]Notification, int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT n.id, n.kind, n.payload, n.read_at, n.created_at, n.issue_id,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM notifications n JOIN users u ON u.id = n.actor_id
		WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()
	notifications := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Payload, &n.ReadAt, &n.CreatedAt, &n.IssueID,
			&n.Actor.ID, &n.Actor.Email, &n.Actor.DisplayName, &n.Actor.AvatarURL,
			&n.Actor.IsActive, &n.Actor.CreatedAt); err != nil {
			return nil, 0, err
		}
		notifications = append(notifications, n)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var unread int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, userID).Scan(&unread); err != nil {
		return nil, 0, err
	}
	return notifications, unread, nil
}

// MarkNotificationsRead marks the given ids (or all when ids is empty).
func (s *Store) MarkNotificationsRead(ctx context.Context, userID string, ids []string) error {
	var err error
	if len(ids) == 0 {
		_, err = s.pool.Exec(ctx,
			`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, userID)
	} else {
		_, err = s.pool.Exec(ctx,
			`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`,
			userID, ids)
	}
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	return nil
}

// FindUsersByEmails resolves mention emails to active users.
func (s *Store) FindUsersByEmails(ctx context.Context, emails []string) ([]User, error) {
	if len(emails) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+userCols+` FROM users WHERE email = ANY($1::citext[]) AND is_active`, emails)
	if err != nil {
		return nil, fmt.Errorf("users by emails: %w", err)
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
