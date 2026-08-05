package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ---- Stage 24: Permission schemes ----

// Permissions gate actions inside a space. Visibility stays membership-based:
// grantees must also be members of the space for a grant to take effect.
var Permissions = []string{
	"administer", "create", "edit", "transition", "delete", "assign", "link",
	"comment", "comment-edit-all", "comment-delete-all",
	"attach", "attach-delete-all",
	"manage-sprints", "manage-versions", "log-work",
}

func ValidPermission(p string) bool {
	for _, k := range Permissions {
		if k == p {
			return true
		}
	}
	return false
}

var GranteeTypes = map[string]bool{
	"role": true, "user": true, "lead": true, "reporter": true, "assignee": true, "anyone": true,
}

type PermissionGrant struct {
	ID          string  `json:"id"`
	Permission  string  `json:"permission"`
	GranteeType string  `json:"granteeType"`
	GranteeID   *string `json:"granteeId"`
	// GranteeName is a display name for user grants (empty otherwise).
	GranteeName string `json:"granteeName"`
}

type PermissionScheme struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	IsDefault   bool              `json:"isDefault"`
	UsedBy      int               `json:"usedBy"`
	Spaces      []string          `json:"spaces,omitempty"` // keys of spaces using the scheme
	Grants      []PermissionGrant `json:"grants,omitempty"`
}

var ErrSchemeExists = errors.New("a scheme with this name already exists")
var ErrSchemeInUse = errors.New("scheme is used by a space")

const schemeSelect = `
SELECT s.id, s.name, s.description, s.is_default,
       COALESCE((SELECT count(*) FROM projects p WHERE p.permission_scheme_id = s.id), 0)
FROM permission_schemes s
`

func scanScheme(row pgx.Row) (PermissionScheme, error) {
	var sc PermissionScheme
	err := row.Scan(&sc.ID, &sc.Name, &sc.Description, &sc.IsDefault, &sc.UsedBy)
	return sc, err
}

func (s *Store) ListPermissionSchemes(ctx context.Context) ([]PermissionScheme, error) {
	rows, err := s.pool.Query(ctx, schemeSelect+`ORDER BY s.is_default DESC, s.name`)
	if err != nil {
		return nil, fmt.Errorf("list schemes: %w", err)
	}
	defer rows.Close()
	schemes := []PermissionScheme{}
	for rows.Next() {
		sc, err := scanScheme(rows)
		if err != nil {
			return nil, err
		}
		schemes = append(schemes, sc)
	}
	return schemes, rows.Err()
}

func (s *Store) GetPermissionScheme(ctx context.Context, id string) (PermissionScheme, error) {
	sc, err := scanScheme(s.pool.QueryRow(ctx, schemeSelect+`WHERE s.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return sc, ErrNotFound
	}
	if err != nil {
		return sc, fmt.Errorf("get scheme: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT g.id, g.permission, g.grantee_type, g.grantee_id,
		       COALESCE((SELECT u.display_name FROM users u WHERE g.grantee_type = 'user' AND u.id::text = g.grantee_id), '')
		FROM permission_grants g WHERE g.scheme_id = $1
		ORDER BY g.permission, g.grantee_type, g.grantee_id NULLS FIRST`, id)
	if err != nil {
		return sc, fmt.Errorf("scheme grants: %w", err)
	}
	defer rows.Close()
	sc.Grants = []PermissionGrant{}
	for rows.Next() {
		var g PermissionGrant
		if err := rows.Scan(&g.ID, &g.Permission, &g.GranteeType, &g.GranteeID, &g.GranteeName); err != nil {
			return sc, err
		}
		sc.Grants = append(sc.Grants, g)
	}
	if err := rows.Err(); err != nil {
		return sc, err
	}
	keyRows, err := s.pool.Query(ctx,
		`SELECT key FROM projects WHERE permission_scheme_id = $1 ORDER BY key`, id)
	if err != nil {
		return sc, fmt.Errorf("scheme spaces: %w", err)
	}
	defer keyRows.Close()
	sc.Spaces = []string{}
	for keyRows.Next() {
		var k string
		if err := keyRows.Scan(&k); err != nil {
			return sc, err
		}
		sc.Spaces = append(sc.Spaces, k)
	}
	return sc, keyRows.Err()
}

// CreatePermissionScheme copies the grants of copyFrom — or of the default
// scheme when empty — so new schemes start usable rather than locked down.
func (s *Store) CreatePermissionScheme(ctx context.Context, name, description, copyFrom string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if copyFrom == "" {
		if err := tx.QueryRow(ctx,
			`SELECT id FROM permission_schemes WHERE is_default`).Scan(&copyFrom); err != nil {
			return "", fmt.Errorf("default scheme: %w", err)
		}
	}
	var id string
	err = tx.QueryRow(ctx,
		`INSERT INTO permission_schemes (name, description) VALUES ($1, $2)
		 ON CONFLICT (name) DO NOTHING RETURNING id`, name, description).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSchemeExists
	}
	if err != nil {
		return "", fmt.Errorf("create scheme: %w", err)
	}
	if copyFrom != "" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO permission_grants (scheme_id, permission, grantee_type, grantee_id)
			SELECT $1, permission, grantee_type, grantee_id FROM permission_grants WHERE scheme_id = $2`,
			id, copyFrom); err != nil {
			return "", fmt.Errorf("copy grants: %w", err)
		}
	}
	return id, tx.Commit(ctx)
}

func (s *Store) UpdatePermissionScheme(ctx context.Context, id, name, description string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE permission_schemes SET name = $2, description = $3 WHERE id = $1`, id, name, description)
	if err != nil {
		return fmt.Errorf("update scheme: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeletePermissionScheme(ctx context.Context, id string) error {
	var inUse int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM projects WHERE permission_scheme_id = $1`, id).Scan(&inUse); err != nil {
		return err
	}
	if inUse > 0 {
		return ErrSchemeInUse
	}
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM permission_schemes WHERE id = $1 AND NOT is_default`, id)
	if err != nil {
		return fmt.Errorf("delete scheme: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AddPermissionGrant(ctx context.Context, schemeID, permission, granteeType string, granteeID *string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO permission_grants (scheme_id, permission, grantee_type, grantee_id)
		VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
		schemeID, permission, granteeType, granteeID)
	if err != nil {
		return fmt.Errorf("add grant: %w", err)
	}
	return nil
}

func (s *Store) RemovePermissionGrant(ctx context.Context, schemeID, grantID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM permission_grants WHERE id = $1 AND scheme_id = $2`, grantID, schemeID)
	if err != nil {
		return fmt.Errorf("remove grant: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetProjectScheme(ctx context.Context, projectKey, schemeID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE projects SET permission_scheme_id = $2 WHERE key = $1`, projectKey, schemeID)
	if err != nil {
		return fmt.Errorf("set project scheme: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ProjectScheme returns the scheme id and name a space uses.
func (s *Store) ProjectScheme(ctx context.Context, projectID string) (string, string, error) {
	var id, name string
	err := s.pool.QueryRow(ctx, `
		SELECT s.id, s.name FROM permission_schemes s
		JOIN projects p ON p.permission_scheme_id = s.id WHERE p.id = $1`, projectID).Scan(&id, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return id, name, err
}

// grantMatch is the shared WHERE fragment deciding whether a grant applies to
// the user. reporter/assignee grants only fire when issue context is given.
const grantMatch = `(
	    g.grantee_type = 'anyone'
	 OR (g.grantee_type = 'role' AND g.grantee_id = (SELECT m.role FROM project_members m WHERE m.project_id = p.id AND m.user_id::text = $2))
	 OR (g.grantee_type = 'user' AND g.grantee_id = $2)
	 OR (g.grantee_type = 'lead' AND p.lead_id::text = $2)
	 OR (g.grantee_type = 'reporter' AND $3 <> '' AND $3 = $2)
	 OR (g.grantee_type = 'assignee' AND $4 <> '' AND $4 = $2)
	)`

// HasPermission resolves one permission through the space's scheme.
// reporterID/assigneeID may be empty when there is no issue in context.
func (s *Store) HasPermission(ctx context.Context, projectID, userID, permission, reporterID, assigneeID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM permission_grants g
			JOIN projects p ON p.permission_scheme_id = g.scheme_id
			WHERE p.id = $1 AND g.permission = $5 AND `+grantMatch+`
		)`, projectID, userID, reporterID, assigneeID, permission).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("has permission: %w", err)
	}
	return ok, nil
}

// MyPermissions lists every permission the user holds in the space (without
// issue context, so reporter/assignee grants are excluded).
func (s *Store) MyPermissions(ctx context.Context, projectID, userID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT g.permission FROM permission_grants g
		JOIN projects p ON p.permission_scheme_id = g.scheme_id
		WHERE p.id = $1 AND `+grantMatch+`
		ORDER BY g.permission`, projectID, userID, "", "")
	if err != nil {
		return nil, fmt.Errorf("my permissions: %w", err)
	}
	defer rows.Close()
	perms := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}
