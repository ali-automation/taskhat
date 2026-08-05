package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage W12: space roles & custom templates ----

// Role ladder: viewer < collaborator < admin. "" means no access (private space).
var wikiRoleRank = map[string]int{"viewer": 1, "collaborator": 2, "admin": 3}

func WikiRoleAtLeast(role, min string) bool {
	return wikiRoleRank[role] >= wikiRoleRank[min]
}

var ErrTemplateExists = errors.New("a template with this name already exists")

// wikiAccessClause renders the "user can see this space" predicate for the
// given space table alias and $-parameter holding the user id.
func wikiAccessClause(spaceAlias, userParam string) string {
	return `(` + spaceAlias + `.default_role <> 'none'
	 OR EXISTS (SELECT 1 FROM wiki_space_members wm WHERE wm.space_id = ` + spaceAlias + `.id AND wm.user_id = ` + userParam + `)
	 OR EXISTS (SELECT 1 FROM users au WHERE au.id = ` + userParam + ` AND au.is_admin))`
}

// WikiSpaceRole resolves the caller's effective role in a space:
// site admins are always admins, explicit membership wins otherwise,
// and non-members fall back to the space's default role ("" = no access).
func (s *Store) WikiSpaceRole(ctx context.Context, spaceID, userID string) (string, error) {
	var role string
	var archived bool
	err := s.pool.QueryRow(ctx, `
		SELECT CASE
			WHEN EXISTS (SELECT 1 FROM users u WHERE u.id::text = $2 AND u.is_admin) THEN 'admin'
			ELSE COALESCE(
				(SELECT m.role FROM wiki_space_members m WHERE m.space_id = $1 AND m.user_id::text = $2),
				(SELECT CASE w.default_role WHEN 'none' THEN '' ELSE w.default_role END FROM wiki_spaces w WHERE w.id = $1),
				'')
		END,
		COALESCE((SELECT w.archived_at IS NOT NULL FROM wiki_spaces w WHERE w.id = $1), false)`,
		spaceID, userID).Scan(&role, &archived)
	if err != nil {
		return "", fmt.Errorf("wiki space role: %w", err)
	}
	// Archived spaces are read-only for everyone but admins (who can restore).
	if archived && role == "collaborator" {
		role = "viewer"
	}
	return role, nil
}

// WikiPageSpaceID is the cheap page → space lookup the role gates use.
func (s *Store) WikiPageSpaceID(ctx context.Context, pageID string) (string, error) {
	var spaceID string
	err := s.pool.QueryRow(ctx, `SELECT space_id FROM wiki_pages WHERE id = $1`, pageID).Scan(&spaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return spaceID, err
}

type WikiSpaceMember struct {
	User User   `json:"user"`
	Role string `json:"role"`
}

func (s *Store) ListWikiSpaceMembers(ctx context.Context, spaceID string) ([]WikiSpaceMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at, m.role
		FROM wiki_space_members m JOIN users u ON u.id = m.user_id
		WHERE m.space_id = $1
		ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'collaborator' THEN 1 ELSE 2 END, u.display_name`, spaceID)
	if err != nil {
		return nil, fmt.Errorf("wiki members: %w", err)
	}
	defer rows.Close()
	members := []WikiSpaceMember{}
	for rows.Next() {
		var m WikiSpaceMember
		if err := rows.Scan(&m.User.ID, &m.User.Email, &m.User.DisplayName, &m.User.AvatarURL,
			&m.User.IsActive, &m.User.CreatedAt, &m.Role); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

func (s *Store) SetWikiSpaceMember(ctx context.Context, spaceID, userID, role string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO wiki_space_members (space_id, user_id, role) VALUES ($1, $2, $3)
		ON CONFLICT (space_id, user_id) DO UPDATE SET role = EXCLUDED.role`, spaceID, userID, role)
	return err
}

func (s *Store) RemoveWikiSpaceMember(ctx context.Context, spaceID, userID string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM wiki_space_members WHERE space_id = $1 AND user_id = $2`, spaceID, userID)
	return err
}

func (s *Store) SetWikiSpaceDefaultRole(ctx context.Context, spaceID, defaultRole string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE wiki_spaces SET default_role = $2, updated_at = now() WHERE id = $1`, spaceID, defaultRole)
	return err
}

func (s *Store) UpdateWikiSpace(ctx context.Context, spaceID, name, description string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE wiki_spaces SET name = $2, description = $3, updated_at = now() WHERE id = $1`,
		spaceID, name, description)
	if err != nil {
		return fmt.Errorf("update wiki space: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- custom templates ----

type WikiTemplate struct {
	ID          string    `json:"id"`
	SpaceID     string    `json:"-"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	BodyDoc     json.RawMessage `json:"bodyDoc"`
	Author      *User     `json:"author"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (s *Store) ListWikiTemplates(ctx context.Context, spaceID string) ([]WikiTemplate, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.space_id, t.name, t.description, t.icon, t.body_doc, t.updated_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_templates t LEFT JOIN users u ON u.id = t.created_by
		WHERE t.space_id = $1 ORDER BY lower(t.name)`, spaceID)
	if err != nil {
		return nil, fmt.Errorf("wiki templates: %w", err)
	}
	defer rows.Close()
	templates := []WikiTemplate{}
	for rows.Next() {
		var t WikiTemplate
		var uid, uemail, uname, uavatar *string
		var uactive *bool
		var ucreated *time.Time
		if err := rows.Scan(&t.ID, &t.SpaceID, &t.Name, &t.Description, &t.Icon, &t.BodyDoc, &t.UpdatedAt,
			&uid, &uemail, &uname, &uavatar, &uactive, &ucreated); err != nil {
			return nil, err
		}
		t.Author = scanNullableUser(uid, uemail, uname, uavatar, uactive, ucreated)
		templates = append(templates, t)
	}
	return templates, rows.Err()
}

func (s *Store) CreateWikiTemplate(ctx context.Context, spaceID, name, description, icon string, bodyDoc []byte, userID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_templates (space_id, name, description, icon, body_doc, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (space_id, lower(name)) DO NOTHING RETURNING id`,
		spaceID, name, description, icon, nullableJSON(bodyDoc), userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTemplateExists
	}
	if err != nil {
		return "", fmt.Errorf("create wiki template: %w", err)
	}
	return id, nil
}

// WikiTemplateMeta returns the template's space and author for access checks.
func (s *Store) WikiTemplateMeta(ctx context.Context, id string) (spaceID string, createdBy *string, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT space_id, created_by FROM wiki_templates WHERE id = $1`, id).Scan(&spaceID, &createdBy)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

func (s *Store) DeleteWikiTemplate(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM wiki_templates WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete wiki template: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// WikiAttachmentPage resolves an attachment to its page for access checks.
func (s *Store) WikiAttachmentPage(ctx context.Context, attachmentID string) (string, error) {
	var pageID string
	err := s.pool.QueryRow(ctx, `SELECT page_id FROM wiki_attachments WHERE id = $1`, attachmentID).Scan(&pageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return pageID, err
}

// ---- Stage W13: blog posts ----

type WikiBlogPost struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Icon      string    `json:"icon"`
	Excerpt   string    `json:"excerpt"`
	Author    *User     `json:"author"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListWikiBlogPosts is the space's chronological blog feed, newest first,
// with the same per-page restriction filter the tree uses.
func (s *Store) ListWikiBlogPosts(ctx context.Context, spaceID, viewerID string) ([]WikiBlogPost, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, LEFT(p.body_text, 280), p.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_pages p LEFT JOIN users u ON u.id = p.created_by
		WHERE p.space_id = $1 AND p.kind = 'blog' AND p.archived_at IS NULL AND p.deleted_at IS NULL
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $2))
		ORDER BY p.created_at DESC`, spaceID, viewerID)
	if err != nil {
		return nil, fmt.Errorf("wiki blog posts: %w", err)
	}
	defer rows.Close()
	posts := []WikiBlogPost{}
	for rows.Next() {
		var p WikiBlogPost
		var uid, uemail, uname, uavatar *string
		var uactive *bool
		var ucreated *time.Time
		if err := rows.Scan(&p.ID, &p.Title, &p.Icon, &p.Excerpt, &p.CreatedAt,
			&uid, &uemail, &uname, &uavatar, &uactive, &ucreated); err != nil {
			return nil, err
		}
		p.Author = scanNullableUser(uid, uemail, uname, uavatar, uactive, ucreated)
		posts = append(posts, p)
	}
	return posts, rows.Err()
}
