package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ---- Confluence import provenance (Stage W6) ----

// WikiPageIDByConfluenceID returns the wiki page previously imported for a
// Confluence page id, or "" when it hasn't been imported yet.
func (s *Store) WikiPageIDByConfluenceID(ctx context.Context, spaceID, confluenceID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM wiki_pages WHERE space_id = $1 AND confluence_id = $2`, spaceID, confluenceID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("wiki page by confluence id: %w", err)
	}
	return id, nil
}

// ImportSetWikiPageParent repairs a page's place in the tree on re-import.
// The importer processes parents before children from Confluence's own
// (acyclic) tree, so no cycle check is needed here.
func (s *Store) ImportSetWikiPageParent(ctx context.Context, pageID string, parentID *string, kind string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE wiki_pages SET parent_id = $2, kind = $3
		WHERE id = $1 AND (parent_id IS DISTINCT FROM $2 OR kind <> $3)
		  AND id <> COALESCE((SELECT home_page_id FROM wiki_spaces WHERE id = wiki_pages.space_id), '00000000-0000-0000-0000-000000000000')`,
		pageID, parentID, kind)
	if err != nil {
		return fmt.Errorf("set wiki parent: %w", err)
	}
	return nil
}

// ImportSetWikiPageAuthors stamps the real Confluence owner and last editor
// on an imported page (byline, contributors filter, feeds). The v1 snapshot
// follows the creator, and inactive placeholder creators don't stay watchers
// — no point queueing notifications for accounts that can't log in.
func (s *Store) ImportSetWikiPageAuthors(ctx context.Context, pageID, createdBy, updatedBy string) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE wiki_pages SET created_by = $2, updated_by = $3
		WHERE id = $1 AND (created_by <> $2 OR updated_by <> $3)`,
		pageID, createdBy, updatedBy); err != nil {
		return fmt.Errorf("set wiki authors: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE wiki_page_versions SET edited_by = $2 WHERE page_id = $1 AND version = 1`,
		pageID, createdBy); err != nil {
		return fmt.Errorf("set wiki v1 author: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `
		DELETE FROM wiki_page_watchers w USING users u
		WHERE w.page_id = $1 AND u.id = w.user_id AND NOT u.is_active`, pageID); err != nil {
		return fmt.Errorf("unwatch placeholders: %w", err)
	}
	return nil
}

func (s *Store) SetWikiPageConfluenceID(ctx context.Context, pageID, confluenceID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE wiki_pages SET confluence_id = $2 WHERE id = $1`, pageID, confluenceID)
	if err != nil {
		return fmt.Errorf("set confluence id: %w", err)
	}
	return nil
}

// WikiAttachmentByConfluenceID finds a previously imported attachment.
func (s *Store) WikiAttachmentByConfluenceID(ctx context.Context, confluenceID string) (id string, imageKey *string, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT id, image_key FROM wiki_attachments WHERE confluence_id = $1`, confluenceID).Scan(&id, &imageKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, fmt.Errorf("wiki attachment by confluence id: %w", err)
	}
	return id, imageKey, nil
}

// ImportInsertWikiAttachment records an imported attachment with provenance.
func (s *Store) ImportInsertWikiAttachment(ctx context.Context, pageID, filename, mime string, size int64, uploaderID, confluenceID string, imageKey *string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_attachments (page_id, filename, mime, size_bytes, uploader_id, confluence_id, image_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		pageID, filename, mime, size, uploaderID, confluenceID, imageKey).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("import wiki attachment: %w", err)
	}
	return id, nil
}
