package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage W16: tree & page operations ----

// ToggleWikiStar flips the caller's star on a page; returns the new state.
func (s *Store) ToggleWikiStar(ctx context.Context, pageID, userID string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM wiki_page_stars WHERE page_id = $1 AND user_id = $2`, pageID, userID)
	if err != nil {
		return false, fmt.Errorf("unstar: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return false, nil
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO wiki_page_stars (page_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		pageID, userID); err != nil {
		return false, fmt.Errorf("star: %w", err)
	}
	return true, nil
}

func (s *Store) WikiPageStarred(ctx context.Context, pageID, userID string) (bool, error) {
	var starred bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM wiki_page_stars WHERE page_id = $1 AND user_id = $2)`,
		pageID, userID).Scan(&starred)
	return starred, err
}

type StarredWikiPage struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Icon      string `json:"icon"`
	Kind      string `json:"kind"`
	SpaceKey  string `json:"spaceKey"`
	SpaceName string `json:"spaceName"`
}

// ListWikiStarred returns the user's starred pages they can still see.
func (s *Store) ListWikiStarred(ctx context.Context, userID string) ([]StarredWikiPage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.kind, sp.key, sp.name
		FROM wiki_page_stars st
		JOIN wiki_pages p ON p.id = st.page_id
		JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE st.user_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $1))
		  AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY st.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("starred pages: %w", err)
	}
	defer rows.Close()
	pages := []StarredWikiPage{}
	for rows.Next() {
		var p StarredWikiPage
		if err := rows.Scan(&p.ID, &p.Title, &p.Icon, &p.Kind, &p.SpaceKey, &p.SpaceName); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

// RenameWikiPage changes the title only (tree renames, folders).
func (s *Store) RenameWikiPage(ctx context.Context, id, title, userID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE wiki_pages SET title = $2, updated_by = $3, updated_at = now() WHERE id = $1`,
		id, title, userID)
	if err != nil {
		return fmt.Errorf("rename wiki page: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CopyWikiPage duplicates a single page (body, icon, labels) as a sibling
// placed right after the original. Children are not copied.
func (s *Store) CopyWikiPage(ctx context.Context, pageID, userID string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("copy tx: %w", err)
	}
	defer tx.Rollback(ctx)
	var newID string
	err = tx.QueryRow(ctx, `
		INSERT INTO wiki_pages (space_id, parent_id, title, icon, kind, position, body_doc, body_text, created_by, updated_by)
		SELECT space_id, parent_id, 'Copy of ' || title, icon, kind, position + 1, body_doc, body_text, $2, $2
		FROM wiki_pages WHERE id = $1
		RETURNING id`, pageID, userID).Scan(&newID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("copy wiki page: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO wiki_page_labels (page_id, label)
		SELECT $2, label FROM wiki_page_labels WHERE page_id = $1`, pageID, newID); err != nil {
		return "", fmt.Errorf("copy labels: %w", err)
	}
	// First version snapshot so history starts clean.
	if _, err := tx.Exec(ctx, `
		INSERT INTO wiki_page_versions (page_id, version, title, icon, body_doc, body_text, edited_by)
		SELECT id, 1, title, icon, body_doc, body_text, $2 FROM wiki_pages WHERE id = $1`,
		newID, userID); err != nil {
		return "", fmt.Errorf("copy version: %w", err)
	}
	return newID, tx.Commit(ctx)
}

// MoveWikiPageTo moves a page (and its whole subtree) to another space
// and/or parent, appended at the end of the target's children.
func (s *Store) MoveWikiPageTo(ctx context.Context, pageID, targetSpaceID string, parentID *string) error {
	// The new parent must not be inside the moved subtree.
	if parentID != nil {
		var bad bool
		if err := s.pool.QueryRow(ctx, `
			WITH RECURSIVE sub AS (
				SELECT id FROM wiki_pages WHERE id = $1
				UNION ALL
				SELECT w.id FROM wiki_pages w JOIN sub ON w.parent_id = sub.id
			)
			SELECT EXISTS (SELECT 1 FROM sub WHERE id = $2)`, pageID, *parentID).Scan(&bad); err != nil {
			return fmt.Errorf("move cycle check: %w", err)
		}
		if bad {
			return errors.New("cannot move a page under itself")
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("move tx: %w", err)
	}
	defer tx.Rollback(ctx)
	// Treat the target space's home page as "top level".
	if parentID != nil {
		var isHome bool
		if err := tx.QueryRow(ctx,
			`SELECT home_page_id = $2 FROM wiki_spaces WHERE id = $1`, targetSpaceID, *parentID).Scan(&isHome); err == nil && isHome {
			parentID = nil
		}
	}
	var pos int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(max(position), -1) + 1 FROM wiki_pages
		WHERE space_id = $1 AND parent_id IS NOT DISTINCT FROM $2`, targetSpaceID, parentID).Scan(&pos); err != nil {
		return fmt.Errorf("move position: %w", err)
	}
	tag, err := tx.Exec(ctx, `
		UPDATE wiki_pages SET parent_id = $2, position = $3, updated_at = now() WHERE id = $1`,
		pageID, parentID, pos)
	if err != nil {
		return fmt.Errorf("move page: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	// The entire subtree follows into the target space.
	if _, err := tx.Exec(ctx, `
		WITH RECURSIVE sub AS (
			SELECT id FROM wiki_pages WHERE id = $1
			UNION ALL
			SELECT w.id FROM wiki_pages w JOIN sub ON w.parent_id = sub.id
		)
		UPDATE wiki_pages SET space_id = $2 WHERE id IN (SELECT id FROM sub)`,
		pageID, targetSpaceID); err != nil {
		return fmt.Errorf("move subtree: %w", err)
	}
	return tx.Commit(ctx)
}

// SetWikiPageArchived archives or restores a page and its subtree.
func (s *Store) SetWikiPageArchived(ctx context.Context, pageID string, archived bool) error {
	var at *time.Time
	if archived {
		now := time.Now().UTC()
		at = &now
	}
	tag, err := s.pool.Exec(ctx, `
		WITH RECURSIVE sub AS (
			SELECT id FROM wiki_pages WHERE id = $1
			UNION ALL
			SELECT w.id FROM wiki_pages w JOIN sub ON w.parent_id = sub.id
		)
		UPDATE wiki_pages SET archived_at = $2 WHERE id IN (SELECT id FROM sub)`,
		pageID, at)
	if err != nil {
		return fmt.Errorf("archive wiki page: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type ArchivedWikiPage struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Icon       string    `json:"icon"`
	Kind       string    `json:"kind"`
	ArchivedAt time.Time `json:"archivedAt"`
}

func (s *Store) ListArchivedWikiPages(ctx context.Context, spaceID string) ([]ArchivedWikiPage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, icon, kind, archived_at FROM wiki_pages
		WHERE space_id = $1 AND archived_at IS NOT NULL AND deleted_at IS NULL
		ORDER BY archived_at DESC`, spaceID)
	if err != nil {
		return nil, fmt.Errorf("archived pages: %w", err)
	}
	defer rows.Close()
	pages := []ArchivedWikiPage{}
	for rows.Next() {
		var p ArchivedWikiPage
		if err := rows.Scan(&p.ID, &p.Title, &p.Icon, &p.Kind, &p.ArchivedAt); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

// ConvertWikiPageKind flips a page between page and blog. Converting to a
// blog detaches it from the tree (children move up).
func (s *Store) ConvertWikiPageKind(ctx context.Context, id, kind string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var current string
	var parentID *string
	err = tx.QueryRow(ctx,
		`SELECT kind, parent_id FROM wiki_pages WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&current, &parentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if (current != "page" && current != "blog") || (kind != "page" && kind != "blog") {
		return errors.New("only pages and blog posts can be converted")
	}
	if kind == "blog" {
		if _, err := tx.Exec(ctx, `UPDATE wiki_pages SET parent_id = $2 WHERE parent_id = $1`, id, parentID); err != nil {
			return fmt.Errorf("convert reparent: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE wiki_pages SET kind = $2, parent_id = CASE WHEN $2 = 'blog' THEN NULL ELSE parent_id END,
		       updated_at = now() WHERE id = $1`, id, kind); err != nil {
		return fmt.Errorf("convert kind: %w", err)
	}
	return tx.Commit(ctx)
}
