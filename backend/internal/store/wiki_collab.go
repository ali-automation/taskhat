package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage W3: page versions ----

// WikiVersion is one published revision; the newest equals the live page.
type WikiVersion struct {
	Version   int       `json:"version"`
	Title     string    `json:"title"`
	Icon      string    `json:"icon"`
	EditedBy  *User     `json:"editedBy"`
	CreatedAt time.Time `json:"createdAt"`
}

type WikiVersionContent struct {
	WikiVersion
	BodyDoc  []byte `json:"bodyDoc"`
	BodyText string `json:"bodyText"`
}

func (s *Store) ListWikiVersions(ctx context.Context, pageID string) ([]WikiVersion, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT v.version, v.title, v.icon, v.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_page_versions v LEFT JOIN users u ON u.id = v.edited_by
		WHERE v.page_id = $1 ORDER BY v.version DESC`, pageID)
	if err != nil {
		return nil, fmt.Errorf("list wiki versions: %w", err)
	}
	defer rows.Close()
	versions := []WikiVersion{}
	for rows.Next() {
		var v WikiVersion
		var uid, email, name, avatar *string
		var active *bool
		var created *time.Time
		if err := rows.Scan(&v.Version, &v.Title, &v.Icon, &v.CreatedAt,
			&uid, &email, &name, &avatar, &active, &created); err != nil {
			return nil, err
		}
		v.EditedBy = scanNullableUser(uid, email, name, avatar, active, created)
		versions = append(versions, v)
	}
	return versions, rows.Err()
}

func (s *Store) GetWikiVersion(ctx context.Context, pageID string, version int) (WikiVersionContent, error) {
	var v WikiVersionContent
	var uid, email, name, avatar *string
	var active *bool
	var created *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT v.version, v.title, v.icon, v.body_doc, v.body_text, v.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_page_versions v LEFT JOIN users u ON u.id = v.edited_by
		WHERE v.page_id = $1 AND v.version = $2`, pageID, version).Scan(
		&v.Version, &v.Title, &v.Icon, &v.BodyDoc, &v.BodyText, &v.CreatedAt,
		&uid, &email, &name, &avatar, &active, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return WikiVersionContent{}, ErrNotFound
	}
	if err != nil {
		return WikiVersionContent{}, fmt.Errorf("get wiki version: %w", err)
	}
	v.EditedBy = scanNullableUser(uid, email, name, avatar, active, created)
	return v, nil
}

// ---- comments (footer thread, like Confluence) ----

// WikiComment extends the base comment with inline anchoring, threading,
// and resolution (Confluence's inline comments).
type WikiComment struct {
	Comment
	ParentID         *string    `json:"parentId"`
	InlineText       string     `json:"inlineText"`
	InlineOccurrence int        `json:"inlineOccurrence"`
	ResolvedAt       *time.Time `json:"resolvedAt"`
}

const wikiCommentSelect = `
SELECT c.id, c.body, c.body_doc, c.edited_at, c.created_at,
       c.parent_id, c.inline_text, c.inline_occurrence, c.resolved_at,
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM wiki_comments c JOIN users u ON u.id = c.author_id
`

func scanWikiComment(row pgx.Row) (WikiComment, error) {
	var c WikiComment
	err := row.Scan(&c.ID, &c.Body, &c.BodyDoc, &c.EditedAt, &c.CreatedAt,
		&c.ParentID, &c.InlineText, &c.InlineOccurrence, &c.ResolvedAt,
		&c.Author.ID, &c.Author.Email, &c.Author.DisplayName, &c.Author.AvatarURL,
		&c.Author.IsActive, &c.Author.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return WikiComment{}, ErrNotFound
	}
	return c, err
}

func (s *Store) ListWikiComments(ctx context.Context, pageID string) ([]WikiComment, error) {
	rows, err := s.pool.Query(ctx, wikiCommentSelect+` WHERE c.page_id = $1 ORDER BY c.created_at`, pageID)
	if err != nil {
		return nil, fmt.Errorf("list wiki comments: %w", err)
	}
	defer rows.Close()
	comments := []WikiComment{}
	for rows.Next() {
		c, err := scanWikiComment(rows)
		if err != nil {
			return nil, err
		}
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// CreateWikiComment adds the comment and makes the author a watcher.
// parentID threads a reply; inlineText anchors the thread to page text.
func (s *Store) CreateWikiComment(ctx context.Context, pageID, authorID, body string, bodyDoc []byte, parentID *string, inlineText string, inlineOccurrence int) (WikiComment, error) {
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_comments (page_id, author_id, body, body_doc, parent_id, inline_text, inline_occurrence)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		pageID, authorID, body, nullableJSON(bodyDoc), parentID, inlineText, inlineOccurrence).Scan(&id); err != nil {
		return WikiComment{}, fmt.Errorf("create wiki comment: %w", err)
	}
	_ = s.WikiWatch(ctx, pageID, authorID)
	return scanWikiComment(s.pool.QueryRow(ctx, wikiCommentSelect+` WHERE c.id = $1`, id))
}

// ResolveWikiComment resolves or reopens an inline thread (root only).
func (s *Store) ResolveWikiComment(ctx context.Context, commentID, userID string, resolved bool) (WikiComment, error) {
	q := `UPDATE wiki_comments SET resolved_at = NULL, resolved_by = NULL WHERE id = $1 AND parent_id IS NULL`
	args := []any{commentID}
	if resolved {
		q = `UPDATE wiki_comments SET resolved_at = now(), resolved_by = $2 WHERE id = $1 AND parent_id IS NULL`
		args = append(args, userID)
	}
	ct, err := s.pool.Exec(ctx, q, args...)
	if err != nil {
		return WikiComment{}, fmt.Errorf("resolve wiki comment: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return WikiComment{}, ErrNotFound
	}
	return scanWikiComment(s.pool.QueryRow(ctx, wikiCommentSelect+` WHERE c.id = $1`, commentID))
}

func (s *Store) UpdateWikiComment(ctx context.Context, id, authorID, body string, bodyDoc []byte) (WikiComment, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE wiki_comments SET body = $3, body_doc = $4, edited_at = now()
		WHERE id = $1 AND author_id = $2`, id, authorID, body, nullableJSON(bodyDoc))
	if err != nil {
		return WikiComment{}, fmt.Errorf("update wiki comment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return WikiComment{}, ErrNotFound
	}
	return scanWikiComment(s.pool.QueryRow(ctx, wikiCommentSelect+` WHERE c.id = $1`, id))
}

// DeleteWikiComment removes the author's own comment (admins may delete any).
func (s *Store) DeleteWikiComment(ctx context.Context, id, userID string, isAdmin bool) (string, error) {
	q := `DELETE FROM wiki_comments WHERE id = $1 AND author_id = $2 RETURNING page_id`
	args := []any{id, userID}
	if isAdmin {
		q = `DELETE FROM wiki_comments WHERE id = $1 RETURNING page_id`
		args = []any{id}
	}
	var pageID string
	err := s.pool.QueryRow(ctx, q, args...).Scan(&pageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("delete wiki comment: %w", err)
	}
	return pageID, nil
}

// WikiCommentPage resolves a comment's page for permission checks.
func (s *Store) WikiCommentPage(ctx context.Context, commentID string) (string, error) {
	var pageID string
	err := s.pool.QueryRow(ctx, `SELECT page_id FROM wiki_comments WHERE id = $1`, commentID).Scan(&pageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return pageID, err
}

// ---- watchers ----

func (s *Store) WikiWatch(ctx context.Context, pageID, userID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO wiki_page_watchers (page_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		pageID, userID)
	return err
}

func (s *Store) WikiUnwatch(ctx context.Context, pageID, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM wiki_page_watchers WHERE page_id = $1 AND user_id = $2`, pageID, userID)
	return err
}

func (s *Store) WikiWatcherIDs(ctx context.Context, pageID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT user_id FROM wiki_page_watchers WHERE page_id = $1
		UNION
		SELECT w.user_id FROM wiki_space_watchers w
		JOIN wiki_pages p ON p.space_id = w.space_id WHERE p.id = $1`, pageID)
	if err != nil {
		return nil, fmt.Errorf("wiki watchers: %w", err)
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

func (s *Store) WikiWatchState(ctx context.Context, pageID, userID string) (bool, int, error) {
	var watching bool
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM wiki_page_watchers WHERE page_id = $1 AND user_id = $2),
		       (SELECT count(*) FROM wiki_page_watchers WHERE page_id = $1)`,
		pageID, userID).Scan(&watching, &count)
	return watching, count, err
}

// ---- attachments ----

type WikiAttachment struct {
	ID        string    `json:"id"`
	Filename  string    `json:"filename"`
	Mime      string    `json:"mime"`
	SizeBytes int64     `json:"sizeBytes"`
	Uploader  *User     `json:"uploader"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Store) CreateWikiAttachment(ctx context.Context, pageID, filename, mime string, size int64, uploaderID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_attachments (page_id, filename, mime, size_bytes, uploader_id)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		pageID, filename, mime, size, uploaderID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create wiki attachment: %w", err)
	}
	return id, nil
}

func (s *Store) ListWikiAttachments(ctx context.Context, pageID string) ([]WikiAttachment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.filename, a.mime, a.size_bytes, a.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_attachments a LEFT JOIN users u ON u.id = a.uploader_id
		WHERE a.page_id = $1 ORDER BY a.created_at`, pageID)
	if err != nil {
		return nil, fmt.Errorf("list wiki attachments: %w", err)
	}
	defer rows.Close()
	atts := []WikiAttachment{}
	for rows.Next() {
		var a WikiAttachment
		var uid, email, name, avatar *string
		var active *bool
		var created *time.Time
		if err := rows.Scan(&a.ID, &a.Filename, &a.Mime, &a.SizeBytes, &a.CreatedAt,
			&uid, &email, &name, &avatar, &active, &created); err != nil {
			return nil, err
		}
		a.Uploader = scanNullableUser(uid, email, name, avatar, active, created)
		atts = append(atts, a)
	}
	return atts, rows.Err()
}

// GetWikiAttachment returns metadata plus the owning page id.
func (s *Store) GetWikiAttachment(ctx context.Context, id string) (WikiAttachment, string, error) {
	var a WikiAttachment
	var pageID string
	err := s.pool.QueryRow(ctx, `
		SELECT id, filename, mime, size_bytes, created_at, page_id
		FROM wiki_attachments WHERE id = $1`, id).Scan(
		&a.ID, &a.Filename, &a.Mime, &a.SizeBytes, &a.CreatedAt, &pageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return WikiAttachment{}, "", ErrNotFound
	}
	return a, pageID, err
}

func (s *Store) DeleteWikiAttachment(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM wiki_attachments WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete wiki attachment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateWikiNotification stores an in-app notification with no issue link;
// the payload carries the wiki page reference instead.
func (s *Store) CreateWikiNotification(ctx context.Context, userID, actorID, kind string, payload any) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notifications (user_id, issue_id, actor_id, kind, payload)
		VALUES ($1, NULL, $2, $3, $4)`, userID, actorID, kind, payload)
	return err
}
