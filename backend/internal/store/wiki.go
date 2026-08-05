package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrWikiKeyTaken = errors.New("a wiki space with this key already exists")

type WikiSpace struct {
	ID          string     `json:"id"`
	Key         string     `json:"key"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	HomePageID  *string    `json:"homePageId"`
	DefaultRole string     `json:"defaultRole"`
	Icon        string     `json:"icon"`
	ArchivedAt  *time.Time `json:"archivedAt"`
	OwnerID     *string    `json:"ownerId"`
	Categories  []string   `json:"categories"`
	PageCount   int        `json:"pageCount"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// WikiPageNode is the tree entry the sidebar renders.
type WikiPageNode struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Icon     string  `json:"icon"`
	Kind     string  `json:"kind"`
	ParentID *string `json:"parentId"`
	Position int     `json:"position"`
}

type WikiCrumb struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type WikiPage struct {
	ID         string          `json:"id"`
	SpaceID    string          `json:"spaceId"`
	SpaceKey   string          `json:"spaceKey"`
	SpaceName  string          `json:"spaceName"`
	ParentID   *string         `json:"parentId"`
	Title      string          `json:"title"`
	Icon       string          `json:"icon"`
	Kind       string          `json:"kind"`
	Position   int             `json:"position"`
	Version    int             `json:"version"`
	BodyDoc    json.RawMessage `json:"bodyDoc"`
	BodyText   string          `json:"bodyText"`
	IsHome     bool            `json:"isHome"`
	ArchivedAt *time.Time      `json:"archivedAt"`
	Views      int             `json:"views"`
	Ancestors  []WikiCrumb     `json:"ancestors"`
	Author     *User           `json:"author"`
	UpdatedBy  *User           `json:"updatedBy"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

const wikiSpaceSelect = `
SELECT s.id, s.key, s.name, s.description, s.home_page_id, s.default_role, s.icon, s.archived_at, s.owner_id,
       COALESCE((SELECT array_agg(c.category ORDER BY c.category) FROM wiki_space_categories c WHERE c.space_id = s.id), '{}'),
       s.created_at, s.updated_at,
       (SELECT count(*) FROM wiki_pages p WHERE p.space_id = s.id AND p.deleted_at IS NULL)
FROM wiki_spaces s
`

func scanWikiSpace(row pgx.Row) (WikiSpace, error) {
	var s WikiSpace
	err := row.Scan(&s.ID, &s.Key, &s.Name, &s.Description, &s.HomePageID,
		&s.DefaultRole, &s.Icon, &s.ArchivedAt, &s.OwnerID, &s.Categories, &s.CreatedAt, &s.UpdatedAt, &s.PageCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return WikiSpace{}, ErrNotFound
	}
	return s, err
}

func (s *Store) ListWikiSpaces(ctx context.Context, userID string) ([]WikiSpace, error) {
	rows, err := s.pool.Query(ctx, wikiSpaceSelect+` WHERE `+wikiAccessClause("s", "$1")+` AND (NOT s.is_personal OR s.owner_id = $1) ORDER BY s.name`, userID)
	if err != nil {
		return nil, fmt.Errorf("list wiki spaces: %w", err)
	}
	defer rows.Close()
	spaces := []WikiSpace{}
	for rows.Next() {
		sp, err := scanWikiSpace(rows)
		if err != nil {
			return nil, err
		}
		spaces = append(spaces, sp)
	}
	return spaces, rows.Err()
}

func (s *Store) GetWikiSpace(ctx context.Context, key string) (WikiSpace, error) {
	return scanWikiSpace(s.pool.QueryRow(ctx, wikiSpaceSelect+` WHERE s.key = $1`, key))
}

// CreateWikiSpace creates the space plus its Overview home page, like Confluence.
func (s *Store) CreateWikiSpace(ctx context.Context, key, name, description, userID string) (WikiSpace, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WikiSpace{}, fmt.Errorf("wiki space tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO wiki_spaces (key, name, description, created_by, owner_id)
		VALUES ($1, $2, $3, $4, $4) RETURNING id`, key, name, description, userID).Scan(&id)
	if isUniqueViolation(err) {
		return WikiSpace{}, ErrWikiKeyTaken
	}
	if err != nil {
		return WikiSpace{}, fmt.Errorf("create wiki space: %w", err)
	}

	var homeID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO wiki_pages (space_id, title, position, created_by, updated_by)
		VALUES ($1, $2, 0, $3, $3) RETURNING id`, id, name, userID).Scan(&homeID); err != nil {
		return WikiSpace{}, fmt.Errorf("create home page: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE wiki_spaces SET home_page_id = $2 WHERE id = $1`, id, homeID); err != nil {
		return WikiSpace{}, fmt.Errorf("set home page: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO wiki_space_members (space_id, user_id, role) VALUES ($1, $2, 'admin')`, id, userID); err != nil {
		return WikiSpace{}, fmt.Errorf("seed space admin: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return WikiSpace{}, err
	}
	return s.GetWikiSpace(ctx, key)
}

// WikiPageTree returns the space's pages as a flat ordered list (client nests).
func (s *Store) WikiPageTree(ctx context.Context, spaceID string) ([]WikiPageNode, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, icon, kind, parent_id, position FROM wiki_pages
		WHERE space_id = $1 AND kind <> 'blog' AND archived_at IS NULL AND deleted_at IS NULL
		ORDER BY parent_id NULLS FIRST, position, created_at`, spaceID)
	if err != nil {
		return nil, fmt.Errorf("wiki tree: %w", err)
	}
	defer rows.Close()
	nodes := []WikiPageNode{}
	for rows.Next() {
		var n WikiPageNode
		if err := rows.Scan(&n.ID, &n.Title, &n.Icon, &n.Kind, &n.ParentID, &n.Position); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

const wikiPageSelect = `
SELECT p.id, p.space_id, sp.key, sp.name, p.parent_id, p.title, p.icon, p.kind, p.position, p.version,
       p.body_doc, p.body_text, p.archived_at, p.created_at, p.updated_at,
       (sp.home_page_id = p.id),
       COALESCE((SELECT count(*) FROM wiki_page_views pv WHERE pv.page_id = p.id), 0),
       a.id, a.email, a.display_name, a.avatar_url, a.is_active, a.created_at,
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM wiki_pages p
JOIN wiki_spaces sp ON sp.id = p.space_id
LEFT JOIN users a ON a.id = p.created_by
LEFT JOIN users u ON u.id = p.updated_by
`

func scanNullableUser(id, email, name, avatar *string, active *bool, created *time.Time) *User {
	if id == nil {
		return nil
	}
	return &User{ID: *id, Email: *email, DisplayName: *name, AvatarURL: avatar, IsActive: *active, CreatedAt: *created}
}

func (s *Store) GetWikiPage(ctx context.Context, id string) (WikiPage, error) {
	var p WikiPage
	var aid, aemail, aname, aavatar *string
	var aactive *bool
	var acreated *time.Time
	var uid, uemail, uname, uavatar *string
	var uactive *bool
	var ucreated *time.Time
	err := s.pool.QueryRow(ctx, wikiPageSelect+` WHERE p.id = $1 AND p.deleted_at IS NULL`, id).Scan(
		&p.ID, &p.SpaceID, &p.SpaceKey, &p.SpaceName, &p.ParentID, &p.Title, &p.Icon, &p.Kind, &p.Position, &p.Version,
		&p.BodyDoc, &p.BodyText, &p.ArchivedAt, &p.CreatedAt, &p.UpdatedAt, &p.IsHome, &p.Views,
		&aid, &aemail, &aname, &aavatar, &aactive, &acreated,
		&uid, &uemail, &uname, &uavatar, &uactive, &ucreated)
	if errors.Is(err, pgx.ErrNoRows) {
		return WikiPage{}, ErrNotFound
	}
	if err != nil {
		return WikiPage{}, fmt.Errorf("get wiki page: %w", err)
	}
	p.Author = scanNullableUser(aid, aemail, aname, aavatar, aactive, acreated)
	p.UpdatedBy = scanNullableUser(uid, uemail, uname, uavatar, uactive, ucreated)

	// Breadcrumb trail, root first.
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE trail AS (
			SELECT id, parent_id, title, 0 AS depth FROM wiki_pages WHERE id = $1
			UNION ALL
			SELECT w.id, w.parent_id, w.title, t.depth + 1
			FROM wiki_pages w JOIN trail t ON w.id = t.parent_id
		)
		SELECT id, title FROM trail WHERE id <> $1 ORDER BY depth DESC`, id)
	if err != nil {
		return WikiPage{}, fmt.Errorf("wiki ancestors: %w", err)
	}
	defer rows.Close()
	p.Ancestors = []WikiCrumb{}
	for rows.Next() {
		var c WikiCrumb
		if err := rows.Scan(&c.ID, &c.Title); err != nil {
			return WikiPage{}, err
		}
		p.Ancestors = append(p.Ancestors, c)
	}
	return p, rows.Err()
}

func (s *Store) CreateWikiPage(ctx context.Context, spaceID string, parentID *string, title, icon, kind string, bodyDoc []byte, bodyText, userID string) (string, error) {
	if kind == "" {
		kind = "page"
	}
	// A parent equal to the space's Overview page means "top level".
	if parentID != nil {
		var isHome bool
		if err := s.pool.QueryRow(ctx,
			`SELECT home_page_id = $2 FROM wiki_spaces WHERE id = $1`, spaceID, *parentID).Scan(&isHome); err == nil && isHome {
			parentID = nil
		}
	}
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_pages (space_id, parent_id, title, icon, kind, position, body_doc, body_text, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5,
		        COALESCE((SELECT max(position) + 1 FROM wiki_pages
		                  WHERE space_id = $1 AND parent_id IS NOT DISTINCT FROM $2), 0),
		        $6, $7, $8, $8)
		RETURNING id`,
		spaceID, parentID, title, icon, kind, nullableJSON(bodyDoc), bodyText, userID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create wiki page: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO wiki_page_versions (page_id, version, title, icon, body_doc, body_text, edited_by)
		VALUES ($1, 1, $2, $3, $4, $5, $6)`,
		id, title, icon, nullableJSON(bodyDoc), bodyText, userID); err != nil {
		return "", fmt.Errorf("create wiki version: %w", err)
	}
	// The author watches pages they create, like Confluence.
	_ = s.WikiWatch(ctx, id, userID)
	return id, nil
}

// UpdateWikiCanvas saves a whiteboard's canvas (and title) in place —
// autosaves every few seconds, so no version snapshot per save.
func (s *Store) UpdateWikiCanvas(ctx context.Context, id, title string, doc []byte, text, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("canvas tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE wiki_pages
		SET title = $2, body_doc = $3, body_text = $4, updated_by = $5, updated_at = now()
		WHERE id = $1`,
		id, title, nullableJSON(doc), text, userID); err != nil {
		return fmt.Errorf("update wiki canvas: %w", err)
	}
	// Autosave fires every couple of seconds; keep history useful by
	// coalescing snapshots into at most one version per 10 minutes.
	var stale bool
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(max(created_at), 'epoch'::timestamptz) < now() - interval '10 minutes'
		FROM wiki_page_versions WHERE page_id = $1`, id).Scan(&stale); err != nil {
		return fmt.Errorf("canvas version check: %w", err)
	}
	if stale {
		var version int
		var icon string
		if err := tx.QueryRow(ctx, `
			UPDATE wiki_pages SET version = version + 1 WHERE id = $1 RETURNING version, icon`,
			id).Scan(&version, &icon); err != nil {
			return fmt.Errorf("bump canvas version: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO wiki_page_versions (page_id, version, title, icon, body_doc, body_text, edited_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			id, version, title, icon, nullableJSON(doc), text, userID); err != nil {
			return fmt.Errorf("snapshot canvas version: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// UpdateWikiPage publishes a new revision: the page row is the live copy and
// every publish appends a wiki_page_versions snapshot (Confluence semantics).
func (s *Store) UpdateWikiPage(ctx context.Context, id, title, icon string, bodyDoc []byte, bodyText, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("update wiki tx: %w", err)
	}
	defer tx.Rollback(ctx)
	var version int
	err = tx.QueryRow(ctx, `
		UPDATE wiki_pages
		SET title = $2, icon = $3, body_doc = $4, body_text = $5, updated_by = $6,
		    updated_at = now(), version = version + 1
		WHERE id = $1 RETURNING version`,
		id, title, icon, nullableJSON(bodyDoc), bodyText, userID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("update wiki page: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO wiki_page_versions (page_id, version, title, icon, body_doc, body_text, edited_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id, version, title, icon, nullableJSON(bodyDoc), bodyText, userID); err != nil {
		return fmt.Errorf("snapshot wiki version: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	// Editors watch pages they touch, like Confluence.
	_ = s.WikiWatch(ctx, id, userID)
	return nil
}

// MoveWikiPage reparents/reorders a page within its space.
func (s *Store) MoveWikiPage(ctx context.Context, id string, parentID *string, position int) error {
	// Refuse cycles: the new parent must not be the page itself or a descendant.
	if parentID != nil {
		var bad bool
		err := s.pool.QueryRow(ctx, `
			WITH RECURSIVE sub AS (
				SELECT id FROM wiki_pages WHERE id = $1
				UNION ALL
				SELECT w.id FROM wiki_pages w JOIN sub ON w.parent_id = sub.id
			)
			SELECT EXISTS (SELECT 1 FROM sub WHERE id = $2)`, id, *parentID).Scan(&bad)
		if err != nil {
			return fmt.Errorf("wiki cycle check: %w", err)
		}
		if bad {
			return errors.New("cannot move a page under itself")
		}
	}
	var spaceID string
	if err := s.pool.QueryRow(ctx, `SELECT space_id FROM wiki_pages WHERE id = $1`, id).Scan(&spaceID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("move wiki page: %w", err)
	}
	// A parent equal to the space's Overview page means "top level".
	if parentID != nil {
		var isHome bool
		if err := s.pool.QueryRow(ctx,
			`SELECT home_page_id = $2 FROM wiki_spaces WHERE id = $1`, spaceID, *parentID).Scan(&isHome); err == nil && isHome {
			parentID = nil
		}
	}
	// Make room at the target slot so sibling order is exact.
	if _, err := s.pool.Exec(ctx, `
		UPDATE wiki_pages SET position = position + 1
		WHERE space_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND position >= $3`,
		spaceID, parentID, position); err != nil {
		return fmt.Errorf("shift siblings: %w", err)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE wiki_pages SET parent_id = $2, position = $3, updated_at = now() WHERE id = $1`,
		id, parentID, position)
	if err != nil {
		return fmt.Errorf("move wiki page: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteWikiPage removes one page; its children move up to the deleted page's
// parent (Confluence keeps descendants). The space home page cannot be deleted.
func (s *Store) DeleteWikiPage(ctx context.Context, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("wiki delete tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var parentID *string
	var isHome bool
	err = tx.QueryRow(ctx, `
		SELECT p.parent_id, (sp.home_page_id = p.id)
		FROM wiki_pages p JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE p.id = $1`, id).Scan(&parentID, &isHome)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("wiki delete lookup: %w", err)
	}
	if isHome {
		return errors.New("the space overview page cannot be deleted")
	}
	if _, err := tx.Exec(ctx, `UPDATE wiki_pages SET parent_id = $2 WHERE parent_id = $1`, id, parentID); err != nil {
		return fmt.Errorf("wiki reparent children: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM wiki_pages WHERE id = $1`, id); err != nil {
		return fmt.Errorf("wiki delete: %w", err)
	}
	return tx.Commit(ctx)
}

// ---- Stage W2: editor images + drafts ----

func (s *Store) CreateWikiImage(ctx context.Context, mime, userID string) (string, error) {
	var key string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_images (mime, uploaded_by) VALUES ($1, $2) RETURNING key`,
		mime, userID).Scan(&key)
	if err != nil {
		return "", fmt.Errorf("create wiki image: %w", err)
	}
	return key, nil
}

func (s *Store) WikiImageMime(ctx context.Context, key string) (string, error) {
	var mime string
	err := s.pool.QueryRow(ctx, `SELECT mime FROM wiki_images WHERE key = $1`, key).Scan(&mime)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return mime, err
}

type WikiDraft struct {
	ID        string          `json:"id"`
	PageID    *string         `json:"pageId"`
	SpaceID   string          `json:"spaceId"`
	ParentID  *string         `json:"parentId"`
	Title     string          `json:"title"`
	BodyDoc   json.RawMessage `json:"bodyDoc"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// SaveWikiDraft upserts the caller's draft: by draft id when known, by
// (user, page) for edits of existing pages, else a fresh new-page draft.
func (s *Store) SaveWikiDraft(ctx context.Context, id string, userID string, pageID *string, spaceID string, parentID *string, title string, bodyDoc []byte) (WikiDraft, error) {
	var draftID string
	var err error
	switch {
	case id != "":
		err = s.pool.QueryRow(ctx, `
			UPDATE wiki_drafts SET title = $3, body_doc = $4, parent_id = $5, updated_at = now()
			WHERE id = $1 AND user_id = $2 RETURNING id`,
			id, userID, title, nullableJSON(bodyDoc), parentID).Scan(&draftID)
	case pageID != nil:
		err = s.pool.QueryRow(ctx, `
			INSERT INTO wiki_drafts (user_id, page_id, space_id, parent_id, title, body_doc)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (user_id, page_id) WHERE page_id IS NOT NULL
			DO UPDATE SET title = EXCLUDED.title, body_doc = EXCLUDED.body_doc, updated_at = now()
			RETURNING id`,
			userID, pageID, spaceID, parentID, title, nullableJSON(bodyDoc)).Scan(&draftID)
	default:
		err = s.pool.QueryRow(ctx, `
			INSERT INTO wiki_drafts (user_id, space_id, parent_id, title, body_doc)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			userID, spaceID, parentID, title, nullableJSON(bodyDoc)).Scan(&draftID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return WikiDraft{}, ErrNotFound
	}
	if err != nil {
		return WikiDraft{}, fmt.Errorf("save wiki draft: %w", err)
	}
	return s.getWikiDraft(ctx, `WHERE id = $1 AND user_id = $2`, draftID, userID)
}

func (s *Store) getWikiDraft(ctx context.Context, where string, args ...any) (WikiDraft, error) {
	var d WikiDraft
	err := s.pool.QueryRow(ctx, `
		SELECT id, page_id, space_id, parent_id, title, body_doc, updated_at
		FROM wiki_drafts `+where, args...).Scan(
		&d.ID, &d.PageID, &d.SpaceID, &d.ParentID, &d.Title, &d.BodyDoc, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return WikiDraft{}, ErrNotFound
	}
	if err != nil {
		return WikiDraft{}, fmt.Errorf("get wiki draft: %w", err)
	}
	return d, nil
}

func (s *Store) WikiDraftForPage(ctx context.Context, userID, pageID string) (WikiDraft, error) {
	return s.getWikiDraft(ctx, `WHERE user_id = $1 AND page_id = $2`, userID, pageID)
}

func (s *Store) DeleteWikiDraft(ctx context.Context, id, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM wiki_drafts WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete wiki draft: %w", err)
	}
	return nil
}

// RecentWikiPage is a lightweight entry for the sidebar's Recent list.
type RecentWikiPage struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	SpaceKey  string    `json:"spaceKey"`
	SpaceName string    `json:"spaceName"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// RecentWikiPages skips pages whose own restrictions exclude the user
// (ancestor inheritance is enforced again on open).
func (s *Store) RecentWikiPages(ctx context.Context, userID string, limit int) ([]RecentWikiPage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, sp.key, sp.name, p.updated_at
		FROM wiki_pages p JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE p.archived_at IS NULL AND p.deleted_at IS NULL
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $2))
		  AND `+wikiAccessClause("sp", "$2")+`
		ORDER BY p.updated_at DESC LIMIT $1`, limit, userID)
	if err != nil {
		return nil, fmt.Errorf("recent wiki pages: %w", err)
	}
	defer rows.Close()
	pages := []RecentWikiPage{}
	for rows.Next() {
		var p RecentWikiPage
		if err := rows.Scan(&p.ID, &p.Title, &p.SpaceKey, &p.SpaceName, &p.UpdatedAt); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}
