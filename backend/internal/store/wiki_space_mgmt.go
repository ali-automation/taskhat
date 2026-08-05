package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage W17: space management ----

func (s *Store) ToggleWikiSpaceStar(ctx context.Context, spaceID, userID string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM wiki_space_stars WHERE space_id = $1 AND user_id = $2`, spaceID, userID)
	if err != nil {
		return false, fmt.Errorf("unstar space: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return false, nil
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO wiki_space_stars (space_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, spaceID, userID)
	return true, err
}

func (s *Store) ToggleWikiSpaceWatch(ctx context.Context, spaceID, userID string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM wiki_space_watchers WHERE space_id = $1 AND user_id = $2`, spaceID, userID)
	if err != nil {
		return false, fmt.Errorf("unwatch space: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return false, nil
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO wiki_space_watchers (space_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, spaceID, userID)
	return true, err
}

// WikiSpaceFlags returns the caller's star/watch state for the space menu.
func (s *Store) WikiSpaceFlags(ctx context.Context, spaceID, userID string) (starred, watching bool, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM wiki_space_stars WHERE space_id = $1 AND user_id = $2),
		       EXISTS (SELECT 1 FROM wiki_space_watchers WHERE space_id = $1 AND user_id = $2)`,
		spaceID, userID).Scan(&starred, &watching)
	return
}

func (s *Store) SetWikiSpaceIcon(ctx context.Context, spaceID, icon string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE wiki_spaces SET icon = $2, updated_at = now() WHERE id = $1`, spaceID, icon)
	return err
}

func (s *Store) SetWikiSpaceOwner(ctx context.Context, spaceID, ownerID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE wiki_spaces SET owner_id = $2, updated_at = now() WHERE id = $1`, spaceID, ownerID)
	if err != nil {
		return fmt.Errorf("set space owner: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	// The owner administers the space.
	return s.SetWikiSpaceMember(ctx, spaceID, ownerID, "admin")
}

// SetWikiSpaceHome points the space at a different overview page.
func (s *Store) SetWikiSpaceHome(ctx context.Context, spaceID, pageID string) error {
	var kind string
	var pageSpace string
	err := s.pool.QueryRow(ctx,
		`SELECT kind, space_id FROM wiki_pages WHERE id = $1 AND deleted_at IS NULL AND archived_at IS NULL`,
		pageID).Scan(&kind, &pageSpace)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if pageSpace != spaceID || kind != "page" {
		return errors.New("the home must be a page in this space")
	}
	_, err = s.pool.Exec(ctx,
		`UPDATE wiki_spaces SET home_page_id = $2, updated_at = now() WHERE id = $1`, spaceID, pageID)
	return err
}

func (s *Store) SetWikiSpaceCategories(ctx context.Context, spaceID string, categories []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM wiki_space_categories WHERE space_id = $1`, spaceID); err != nil {
		return fmt.Errorf("clear categories: %w", err)
	}
	for _, c := range categories {
		if _, err := tx.Exec(ctx, `
			INSERT INTO wiki_space_categories (space_id, category) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			spaceID, c); err != nil {
			return fmt.Errorf("add category: %w", err)
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) SetWikiSpaceArchived(ctx context.Context, spaceID string, archived bool) error {
	var at *time.Time
	if archived {
		now := time.Now().UTC()
		at = &now
	}
	_, err := s.pool.Exec(ctx,
		`UPDATE wiki_spaces SET archived_at = $2, updated_at = now() WHERE id = $1`, spaceID, at)
	return err
}

// wikiAttachmentBlobKeys lists the storage keys behind attachments — the
// binary ("wiki-att/{id}") plus the public inline-image copy when one was
// minted — so permanent deletes can clean object storage too.
func (s *Store) wikiAttachmentBlobKeys(ctx context.Context, where string, arg any) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.image_key FROM wiki_attachments a
		JOIN wiki_pages p ON p.id = a.page_id `+where, arg)
	if err != nil {
		return nil, fmt.Errorf("attachment blob keys: %w", err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var id string
		var imageKey *string
		if err := rows.Scan(&id, &imageKey); err != nil {
			return nil, err
		}
		keys = append(keys, "wiki-att/"+id)
		if imageKey != nil && *imageKey != "" {
			keys = append(keys, "wiki/"+*imageKey)
		}
	}
	return keys, rows.Err()
}

// DeleteWikiSpace removes the space and everything in it, returning the
// attachment storage keys the caller should delete from blob storage.
func (s *Store) DeleteWikiSpace(ctx context.Context, spaceID string) ([]string, error) {
	blobKeys, err := s.wikiAttachmentBlobKeys(ctx, `WHERE p.space_id = $1`, spaceID)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE wiki_spaces SET home_page_id = NULL WHERE id = $1`, spaceID); err != nil {
		return nil, fmt.Errorf("detach home: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM wiki_pages WHERE space_id = $1`, spaceID); err != nil {
		return nil, fmt.Errorf("delete pages: %w", err)
	}
	tag, err := tx.Exec(ctx, `DELETE FROM wiki_spaces WHERE id = $1`, spaceID)
	if err != nil {
		return nil, fmt.Errorf("delete space: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return blobKeys, tx.Commit(ctx)
}

// ---- trash ----

// TrashWikiPage soft-deletes a page: children move up, the page itself is
// detached into the space trash.
func (s *Store) TrashWikiPage(ctx context.Context, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var parentID *string
	var isHome bool
	err = tx.QueryRow(ctx, `
		SELECT p.parent_id, (sp.home_page_id = p.id)
		FROM wiki_pages p JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE p.id = $1 AND p.deleted_at IS NULL`, id).Scan(&parentID, &isHome)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("trash lookup: %w", err)
	}
	if isHome {
		return errors.New("the space overview page cannot be deleted")
	}
	if _, err := tx.Exec(ctx, `UPDATE wiki_pages SET parent_id = $2 WHERE parent_id = $1`, id, parentID); err != nil {
		return fmt.Errorf("trash reparent: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE wiki_pages SET deleted_at = now(), parent_id = NULL WHERE id = $1`, id); err != nil {
		return fmt.Errorf("trash page: %w", err)
	}
	return tx.Commit(ctx)
}

type TrashedWikiPage struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Icon      string    `json:"icon"`
	Kind      string    `json:"kind"`
	DeletedAt time.Time `json:"deletedAt"`
}

func (s *Store) ListWikiTrash(ctx context.Context, spaceID string) ([]TrashedWikiPage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, icon, kind, deleted_at FROM wiki_pages
		WHERE space_id = $1 AND deleted_at IS NOT NULL
		ORDER BY deleted_at DESC`, spaceID)
	if err != nil {
		return nil, fmt.Errorf("wiki trash: %w", err)
	}
	defer rows.Close()
	pages := []TrashedWikiPage{}
	for rows.Next() {
		var p TrashedWikiPage
		if err := rows.Scan(&p.ID, &p.Title, &p.Icon, &p.Kind, &p.DeletedAt); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

// RestoreWikiPage brings a trashed page back at the space top level.
func (s *Store) RestoreWikiPage(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE wiki_pages SET deleted_at = NULL, archived_at = NULL,
		       position = (SELECT COALESCE(max(position), -1) + 1 FROM wiki_pages p2
		                   WHERE p2.space_id = wiki_pages.space_id AND p2.parent_id IS NULL AND p2.deleted_at IS NULL)
		WHERE id = $1 AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return fmt.Errorf("restore page: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// PurgeWikiPage permanently deletes a trashed page, returning the attachment
// storage keys the caller should delete from blob storage.
func (s *Store) PurgeWikiPage(ctx context.Context, id string) ([]string, error) {
	blobKeys, err := s.wikiAttachmentBlobKeys(ctx, `WHERE p.id = $1`, id)
	if err != nil {
		return nil, err
	}
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM wiki_pages WHERE id = $1 AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return nil, fmt.Errorf("purge page: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return blobKeys, nil
}

type StarredWikiSpace struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

func (s *Store) ListWikiStarredSpaces(ctx context.Context, userID string) ([]StarredWikiSpace, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT sp.id, sp.key, sp.name, sp.icon
		FROM wiki_space_stars st JOIN wiki_spaces sp ON sp.id = st.space_id
		WHERE st.user_id = $1 AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY st.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("starred spaces: %w", err)
	}
	defer rows.Close()
	spaces := []StarredWikiSpace{}
	for rows.Next() {
		var sp StarredWikiSpace
		if err := rows.Scan(&sp.ID, &sp.Key, &sp.Name, &sp.Icon); err != nil {
			return nil, err
		}
		spaces = append(spaces, sp)
	}
	return spaces, rows.Err()
}
