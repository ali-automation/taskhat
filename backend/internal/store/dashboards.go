package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrDashboardNameTaken = errors.New("you already have a dashboard with this name")

type Gadget struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Title    string          `json:"title"`
	Col      int             `json:"col"`
	Position int             `json:"position"`
	Config   json.RawMessage `json:"config"`
}

type Dashboard struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	IsShared    bool      `json:"isShared"`
	IsDefault   bool      `json:"isDefault"`
	Owner       *User     `json:"owner"` // nil = site dashboard, managed by admins
	GadgetCount int       `json:"gadgetCount"`
	Gadgets     []Gadget  `json:"gadgets,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const dashboardSelect = `
SELECT d.id, d.name, d.description, d.is_shared, d.is_default, d.created_at, d.updated_at,
       (SELECT count(*) FROM dashboard_gadgets g WHERE g.dashboard_id = d.id),
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM dashboards d LEFT JOIN users u ON u.id = d.owner_id
`

func scanDashboard(row pgx.Row) (Dashboard, error) {
	var d Dashboard
	var uid, email, name, avatar *string
	var active *bool
	var created *time.Time
	err := row.Scan(&d.ID, &d.Name, &d.Description, &d.IsShared, &d.IsDefault,
		&d.CreatedAt, &d.UpdatedAt, &d.GadgetCount,
		&uid, &email, &name, &avatar, &active, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return Dashboard{}, ErrNotFound
	}
	if err != nil {
		return Dashboard{}, err
	}
	if uid != nil {
		d.Owner = &User{ID: *uid, Email: *email, DisplayName: *name, AvatarURL: avatar, IsActive: *active, CreatedAt: *created}
	}
	return d, nil
}

// ListDashboards returns the default dashboard, the user's own, and shared ones.
func (s *Store) ListDashboards(ctx context.Context, userID string) ([]Dashboard, error) {
	rows, err := s.pool.Query(ctx, dashboardSelect+`
		WHERE d.owner_id = $1 OR d.is_shared OR d.is_default
		ORDER BY d.is_default DESC, (d.owner_id = $1) DESC NULLS LAST, d.name`, userID)
	if err != nil {
		return nil, fmt.Errorf("list dashboards: %w", err)
	}
	defer rows.Close()
	dashboards := []Dashboard{}
	for rows.Next() {
		d, err := scanDashboard(rows)
		if err != nil {
			return nil, err
		}
		dashboards = append(dashboards, d)
	}
	return dashboards, rows.Err()
}

// GetDashboard loads a dashboard the user may view, with its gadgets.
func (s *Store) GetDashboard(ctx context.Context, id, userID string) (Dashboard, error) {
	d, err := scanDashboard(s.pool.QueryRow(ctx, dashboardSelect+`
		WHERE d.id = $1 AND (d.owner_id = $2 OR d.is_shared OR d.is_default)`, id, userID))
	if err != nil {
		return Dashboard{}, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, gadget_type, title, col, position, config
		FROM dashboard_gadgets WHERE dashboard_id = $1 ORDER BY col, position`, id)
	if err != nil {
		return Dashboard{}, fmt.Errorf("list gadgets: %w", err)
	}
	defer rows.Close()
	d.Gadgets = []Gadget{}
	for rows.Next() {
		var g Gadget
		if err := rows.Scan(&g.ID, &g.Type, &g.Title, &g.Col, &g.Position, &g.Config); err != nil {
			return Dashboard{}, err
		}
		d.Gadgets = append(d.Gadgets, g)
	}
	return d, rows.Err()
}

// GetDashboardMeta loads a dashboard without an access filter (for edit checks).
func (s *Store) GetDashboardMeta(ctx context.Context, id string) (Dashboard, error) {
	return scanDashboard(s.pool.QueryRow(ctx, dashboardSelect+` WHERE d.id = $1`, id))
}

// DefaultDashboardID returns the site default dashboard's id.
func (s *Store) DefaultDashboardID(ctx context.Context) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM dashboards WHERE is_default`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

func (s *Store) CreateDashboard(ctx context.Context, ownerID, name, description string, isShared bool) (Dashboard, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO dashboards (owner_id, name, description, is_shared)
		VALUES ($1, $2, $3, $4) RETURNING id`, ownerID, name, description, isShared).Scan(&id)
	if isUniqueViolation(err) {
		return Dashboard{}, ErrDashboardNameTaken
	}
	if err != nil {
		return Dashboard{}, fmt.Errorf("create dashboard: %w", err)
	}
	return s.GetDashboard(ctx, id, ownerID)
}

func (s *Store) UpdateDashboard(ctx context.Context, id, name, description string, isShared bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE dashboards SET name = $2, description = $3, is_shared = $4, updated_at = now()
		WHERE id = $1`, id, name, description, isShared)
	if isUniqueViolation(err) {
		return ErrDashboardNameTaken
	}
	if err != nil {
		return fmt.Errorf("update dashboard: %w", err)
	}
	return nil
}

func (s *Store) DeleteDashboard(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM dashboards WHERE id = $1 AND NOT is_default`, id)
	if err != nil {
		return fmt.Errorf("delete dashboard: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddGadget appends a gadget to the end of the emptier column, like Jira.
func (s *Store) AddGadget(ctx context.Context, dashboardID, gadgetType, title string, config json.RawMessage) (Gadget, error) {
	var col, position int
	err := s.pool.QueryRow(ctx, `
		SELECT CASE WHEN count(*) FILTER (WHERE col = 0) <= count(*) FILTER (WHERE col <> 0) THEN 0 ELSE 1 END,
		       COALESCE(max(position) + 1, 0)
		FROM dashboard_gadgets WHERE dashboard_id = $1`, dashboardID).Scan(&col, &position)
	if err != nil {
		return Gadget{}, fmt.Errorf("gadget placement: %w", err)
	}
	g := Gadget{Type: gadgetType, Title: title, Col: col, Position: position, Config: config}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO dashboard_gadgets (dashboard_id, gadget_type, title, col, position, config)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		dashboardID, gadgetType, title, col, position, config).Scan(&g.ID)
	if err != nil {
		return Gadget{}, fmt.Errorf("add gadget: %w", err)
	}
	s.touchDashboard(ctx, dashboardID)
	return g, nil
}

func (s *Store) UpdateGadget(ctx context.Context, dashboardID, gadgetID, title string, config json.RawMessage) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE dashboard_gadgets SET title = $3, config = $4
		WHERE id = $2 AND dashboard_id = $1`, dashboardID, gadgetID, title, config)
	if err != nil {
		return fmt.Errorf("update gadget: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.touchDashboard(ctx, dashboardID)
	return nil
}

func (s *Store) DeleteGadget(ctx context.Context, dashboardID, gadgetID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM dashboard_gadgets WHERE id = $2 AND dashboard_id = $1`, dashboardID, gadgetID)
	if err != nil {
		return fmt.Errorf("delete gadget: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.touchDashboard(ctx, dashboardID)
	return nil
}

type GadgetPlacement struct {
	ID       string `json:"id"`
	Col      int    `json:"col"`
	Position int    `json:"position"`
}

// SaveGadgetLayout applies the full column/position layout in one transaction.
func (s *Store) SaveGadgetLayout(ctx context.Context, dashboardID string, layout []GadgetPlacement) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("layout tx: %w", err)
	}
	defer tx.Rollback(ctx)
	for _, p := range layout {
		if _, err := tx.Exec(ctx, `
			UPDATE dashboard_gadgets SET col = $3, position = $4
			WHERE id = $2 AND dashboard_id = $1`, dashboardID, p.ID, p.Col, p.Position); err != nil {
			return fmt.Errorf("layout update: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.touchDashboard(ctx, dashboardID)
	return nil
}

func (s *Store) touchDashboard(ctx context.Context, id string) {
	_, _ = s.pool.Exec(ctx, `UPDATE dashboards SET updated_at = now() WHERE id = $1`, id)
}

type PieSlice struct {
	Label    string `json:"label"`
	Category string `json:"category"` // status category when grouping by status, else ""
	Count    int    `json:"count"`
}

// PieCounts groups TQL results for the pie chart gadget. The joins mirror
// SearchIssues so compiled TQL aliases (i, p, s, sp) resolve identically.
func (s *Store) PieCounts(ctx context.Context, userID, whereSQL string, whereArgs []any, by string) ([]PieSlice, error) {
	expr, category := "", "''"
	switch by {
	case "status":
		expr, category = "s.name", "s.category"
	case "type":
		expr = "i.type"
	case "priority":
		expr = "i.priority"
	case "assignee":
		expr = "COALESCE(au.display_name, 'Unassigned')"
	default:
		return nil, fmt.Errorf("unsupported pie grouping %q", by)
	}
	where := `i.project_id IN (SELECT p2.id FROM projects p2
		JOIN project_members m ON m.project_id = p2.id
		WHERE m.user_id = $1 AND p2.archived_at IS NULL)`
	if whereSQL != "" {
		where += " AND (" + numberPlaceholders(whereSQL, 2) + ")"
	}
	args := append([]any{userID}, whereArgs...)
	rows, err := s.pool.Query(ctx, `
		SELECT `+expr+`, `+category+`, count(*)
		FROM issues i
		JOIN projects p ON p.id = i.project_id
		JOIN statuses s ON s.id = i.status_id
		LEFT JOIN sprints sp ON sp.id = i.sprint_id
		LEFT JOIN users au ON au.id = i.assignee_id
		WHERE `+where+`
		GROUP BY 1, 2 ORDER BY 3 DESC, 1`, args...)
	if err != nil {
		return nil, fmt.Errorf("pie counts: %w", err)
	}
	defer rows.Close()
	slices := []PieSlice{}
	for rows.Next() {
		var p PieSlice
		if err := rows.Scan(&p.Label, &p.Category, &p.Count); err != nil {
			return nil, err
		}
		slices = append(slices, p)
	}
	return slices, rows.Err()
}

// RecentActivity streams issue events across the user's spaces (optionally one).
func (s *Store) RecentActivity(ctx context.Context, userID, projectKey string, limit int) ([]ActivityEntry, error) {
	q := `
		SELECT p.key || '-' || i.number, i.summary, e.field, COALESCE(e.new_value::text, ''), e.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM issue_events e
		JOIN issues i ON i.id = e.issue_id
		JOIN projects p ON p.id = i.project_id
		JOIN users u ON u.id = e.actor_id
		WHERE i.project_id IN (SELECT p2.id FROM projects p2
			JOIN project_members m ON m.project_id = p2.id
			WHERE m.user_id = $1 AND p2.archived_at IS NULL)`
	args := []any{userID, limit}
	if projectKey != "" {
		q += ` AND p.key = $3`
		args = append(args, projectKey)
	}
	q += ` ORDER BY e.created_at DESC LIMIT $2`
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("recent activity: %w", err)
	}
	defer rows.Close()
	entries := []ActivityEntry{}
	for rows.Next() {
		var a ActivityEntry
		if err := rows.Scan(&a.IssueKey, &a.IssueSummary, &a.Field, &a.NewValue, &a.CreatedAt,
			&a.Actor.ID, &a.Actor.Email, &a.Actor.DisplayName, &a.Actor.AvatarURL,
			&a.Actor.IsActive, &a.Actor.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, a)
	}
	return entries, rows.Err()
}

// ActiveSprint finds the running sprint on a project's board, if any.
func (s *Store) ActiveSprint(ctx context.Context, projectID string) (*Sprint, error) {
	sp, err := scanSprint(s.pool.QueryRow(ctx, `
		SELECT `+sprintCols+` FROM sprints
		WHERE board_id IN (SELECT id FROM boards WHERE project_id = $1) AND state = 'active'
		ORDER BY start_at DESC LIMIT 1`, projectID))
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("active sprint: %w", err)
	}
	return &sp, nil
}
