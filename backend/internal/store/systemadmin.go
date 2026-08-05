package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrCategoryTaken = errors.New("a category with this name already exists")

// ---- audit log ----

type AuditEntry struct {
	ID        string          `json:"id"`
	Actor     *User           `json:"actor"` // nil for anonymous (failed logins)
	Action    string          `json:"action"`
	Target    string          `json:"target"`
	Details   json.RawMessage `json:"details"`
	IP        string          `json:"ip"`
	CreatedAt time.Time       `json:"createdAt"`
}

// Audit appends a trail row; best-effort by design (callers ignore errors).
func (s *Store) Audit(ctx context.Context, actorID *string, action, target, ip string, details map[string]any) {
	raw, err := json.Marshal(details)
	if err != nil || details == nil {
		raw = []byte("{}")
	}
	_, _ = s.pool.Exec(ctx,
		`INSERT INTO audit_log (actor_id, action, target, details, ip) VALUES ($1, $2, $3, $4, $5)`,
		actorID, action, target, raw, ip)
}

// ListAudit returns a page of the audit trail, newest first.
func (s *Store) ListAudit(ctx context.Context, query, action string, startAt, maxResults int) ([]AuditEntry, int, error) {
	where := `WHERE ($1 = '' OR l.action = $1)
	  AND ($2 = '' OR l.target ILIKE '%' || $2 || '%' OR l.action ILIKE '%' || $2 || '%'
	       OR u.display_name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')`

	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id `+where,
		action, query).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("audit count: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.action, l.target, l.details, l.ip, l.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM audit_log l
		LEFT JOIN users u ON u.id = l.actor_id
		`+where+`
		ORDER BY l.created_at DESC
		LIMIT $3 OFFSET $4`, action, query, maxResults, startAt)
	if err != nil {
		return nil, 0, fmt.Errorf("audit list: %w", err)
	}
	defer rows.Close()
	entries := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var uID, uEmail, uName, uAvatar *string
		var uActive *bool
		var uCreated *time.Time
		if err := rows.Scan(&e.ID, &e.Action, &e.Target, &e.Details, &e.IP, &e.CreatedAt,
			&uID, &uEmail, &uName, &uAvatar, &uActive, &uCreated); err != nil {
			return nil, 0, err
		}
		if uID != nil {
			e.Actor = &User{ID: *uID, Email: *uEmail, DisplayName: *uName, AvatarURL: uAvatar, IsActive: *uActive, CreatedAt: *uCreated}
		}
		entries = append(entries, e)
	}
	return entries, total, rows.Err()
}

// AuditActions returns the distinct action names (for the filter dropdown).
func (s *Store) AuditActions(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT action FROM audit_log ORDER BY action`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	actions := []string{}
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			return nil, err
		}
		actions = append(actions, a)
	}
	return actions, rows.Err()
}

// ---- space categories ----

type SpaceCategory struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	SpaceCount int    `json:"spaceCount"`
}

func (s *Store) ListCategories(ctx context.Context) ([]SpaceCategory, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.name, (SELECT count(*) FROM projects p WHERE p.category_id = c.id)
		FROM space_categories c ORDER BY c.name`)
	if err != nil {
		return nil, fmt.Errorf("categories: %w", err)
	}
	defer rows.Close()
	cats := []SpaceCategory{}
	for rows.Next() {
		var c SpaceCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.SpaceCount); err != nil {
			return nil, err
		}
		cats = append(cats, c)
	}
	return cats, rows.Err()
}

func (s *Store) CreateCategory(ctx context.Context, name string) (SpaceCategory, error) {
	var c SpaceCategory
	err := s.pool.QueryRow(ctx,
		`INSERT INTO space_categories (name) VALUES ($1) RETURNING id, name`, name).Scan(&c.ID, &c.Name)
	if isUniqueViolation(err) {
		return SpaceCategory{}, ErrCategoryTaken
	}
	if err != nil {
		return SpaceCategory{}, fmt.Errorf("create category: %w", err)
	}
	return c, nil
}

func (s *Store) DeleteCategory(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM space_categories WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete category: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetProjectCategory(ctx context.Context, key string, categoryID *string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE projects SET category_id = $2, updated_at = now() WHERE key = $1`, key, categoryID)
	if err != nil {
		var pgErr interface{ SQLState() string }
		if errors.As(err, &pgErr) && pgErr.SQLState() == "23503" { // fk violation
			return ErrNotFound
		}
		return fmt.Errorf("set category: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CategoryNameOf returns a project's category name ("" when none).
func (s *Store) CategoryNameOf(ctx context.Context, projectID string) (string, error) {
	var name *string
	err := s.pool.QueryRow(ctx, `
		SELECT c.name FROM projects p LEFT JOIN space_categories c ON c.id = p.category_id
		WHERE p.id = $1`, projectID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if name == nil {
		return "", err
	}
	return *name, err
}

// ---- security / default settings helpers ----

// SettingInt reads a numeric site setting with a default.
func (s *Store) SettingInt(ctx context.Context, key string, def int) int {
	settings, err := s.SiteSettings(ctx)
	if err != nil {
		return def
	}
	if v, err := strconv.Atoi(settings[key]); err == nil && v > 0 {
		return v
	}
	return def
}

// SettingStr reads a site setting with a default.
func (s *Store) SettingStr(ctx context.Context, key, def string) string {
	settings, err := s.SiteSettings(ctx)
	if err != nil {
		return def
	}
	if v := settings[key]; v != "" {
		return v
	}
	return def
}
