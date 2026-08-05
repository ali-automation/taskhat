package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// numberPlaceholders rewrites ?-style placeholders to $N starting at n.
func numberPlaceholders(sql string, start int) string {
	var b strings.Builder
	n := start
	for _, c := range sql {
		if c == '?' {
			fmt.Fprintf(&b, "$%d", n)
			n++
		} else {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// SearchIssues runs a compiled TQL query scoped to the user's projects.
func (s *Store) SearchIssues(ctx context.Context, userID, whereSQL string, whereArgs []any, orderBy string, startAt, maxResults int) ([]Issue, int, error) {
	scope := `i.project_id IN (SELECT p2.id FROM projects p2
		JOIN project_members m ON m.project_id = p2.id
		WHERE m.user_id = $1 AND p2.archived_at IS NULL)`
	where := scope
	if whereSQL != "" {
		where += " AND (" + numberPlaceholders(whereSQL, 2) + ")"
	}
	args := append([]any{userID}, whereArgs...)

	var total int
	countSQL := `SELECT count(*) FROM issues i
		JOIN projects p ON p.id = i.project_id
		JOIN statuses s ON s.id = i.status_id
		LEFT JOIN sprints sp ON sp.id = i.sprint_id
		WHERE ` + where
	if err := s.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("search count: %w", err)
	}

	limitArgs := append(args, maxResults, startAt)
	query := issueSelect + ` WHERE ` + where +
		fmt.Sprintf(" ORDER BY %s LIMIT $%d OFFSET $%d", orderBy, len(args)+1, len(args)+2)
	rows, err := s.pool.Query(ctx, query, limitArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("search: %w", err)
	}
	defer rows.Close()
	issues := []Issue{}
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			return nil, 0, err
		}
		issues = append(issues, i)
	}
	return issues, total, rows.Err()
}

// QuickSearch matches by key prefix or summary substring across the user's projects.
func (s *Store) QuickSearch(ctx context.Context, userID, q string, limit int) ([]Issue, error) {
	rows, err := s.pool.Query(ctx, issueSelect+`
		WHERE i.project_id IN (SELECT project_id FROM project_members WHERE user_id = $1)
		  AND p.archived_at IS NULL
		  AND ((p.key || '-' || i.number) ILIKE $2 || '%'
		       OR i.summary ILIKE '%' || $2 || '%'
		       OR ($2 ~ '^[0-9]+$' AND i.number::text = $2))
		ORDER BY i.updated_at DESC LIMIT $3`, userID, q, limit)
	if err != nil {
		return nil, fmt.Errorf("quick search: %w", err)
	}
	defer rows.Close()
	issues := []Issue{}
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			return nil, err
		}
		issues = append(issues, i)
	}
	return issues, rows.Err()
}

type Filter struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	TQL       string    `json:"tql"`
	IsShared  bool      `json:"isShared"`
	Owner     User      `json:"owner"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

var ErrFilterNameTaken = errors.New("you already have a filter with this name")

const filterSelect = `
SELECT f.id, f.name, f.tql, f.is_shared, f.created_at, f.updated_at,
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM filters f JOIN users u ON u.id = f.owner_id
`

func scanFilter(row pgx.Row) (Filter, error) {
	var f Filter
	err := row.Scan(&f.ID, &f.Name, &f.TQL, &f.IsShared, &f.CreatedAt, &f.UpdatedAt,
		&f.Owner.ID, &f.Owner.Email, &f.Owner.DisplayName, &f.Owner.AvatarURL,
		&f.Owner.IsActive, &f.Owner.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Filter{}, ErrNotFound
	}
	return f, err
}

// ListFilters returns the user's filters plus shared ones, own first.
func (s *Store) ListFilters(ctx context.Context, userID string) ([]Filter, error) {
	rows, err := s.pool.Query(ctx, filterSelect+`
		WHERE f.owner_id = $1 OR f.is_shared
		ORDER BY (f.owner_id = $1) DESC, f.name`, userID)
	if err != nil {
		return nil, fmt.Errorf("list filters: %w", err)
	}
	defer rows.Close()
	filters := []Filter{}
	for rows.Next() {
		f, err := scanFilter(rows)
		if err != nil {
			return nil, err
		}
		filters = append(filters, f)
	}
	return filters, rows.Err()
}

func (s *Store) CreateFilter(ctx context.Context, ownerID, name, tqlText string, isShared bool) (Filter, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO filters (owner_id, name, tql, is_shared) VALUES ($1, $2, $3, $4) RETURNING id`,
		ownerID, name, tqlText, isShared).Scan(&id)
	if isUniqueViolation(err) {
		return Filter{}, ErrFilterNameTaken
	}
	if err != nil {
		return Filter{}, fmt.Errorf("create filter: %w", err)
	}
	return scanFilter(s.pool.QueryRow(ctx, filterSelect+` WHERE f.id = $1`, id))
}

func (s *Store) UpdateFilter(ctx context.Context, id, ownerID, name, tqlText string, isShared bool) (Filter, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE filters SET name = $3, tql = $4, is_shared = $5, updated_at = now()
		WHERE id = $1 AND owner_id = $2`, id, ownerID, name, tqlText, isShared)
	if isUniqueViolation(err) {
		return Filter{}, ErrFilterNameTaken
	}
	if err != nil {
		return Filter{}, fmt.Errorf("update filter: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Filter{}, ErrNotFound
	}
	return scanFilter(s.pool.QueryRow(ctx, filterSelect+` WHERE f.id = $1`, id))
}

func (s *Store) DeleteFilter(ctx context.Context, id, ownerID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM filters WHERE id = $1 AND owner_id = $2`, id, ownerID)
	if err != nil {
		return fmt.Errorf("delete filter: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type StatusCount struct {
	Status   string `json:"status"`
	Category string `json:"category"`
	Count    int    `json:"count"`
}

type WorkloadEntry struct {
	User      *User `json:"user"` // nil = unassigned
	OpenCount int   `json:"openCount"`
}

type ActivityEntry struct {
	IssueKey     string    `json:"issueKey"`
	IssueSummary string    `json:"issueSummary"`
	Field        string    `json:"field"`
	NewValue     string    `json:"newValue"`
	Actor        User      `json:"actor"`
	CreatedAt    time.Time `json:"createdAt"`
}

type ProjectSummary struct {
	StatusCounts []StatusCount   `json:"statusCounts"`
	TypeCounts   map[string]int  `json:"typeCounts"`
	Workload     []WorkloadEntry `json:"workload"`
	Activity     []ActivityEntry `json:"activity"`
	Open         int             `json:"open"`
	Done         int             `json:"done"`
	Total        int             `json:"total"`
}

func (s *Store) GetProjectSummary(ctx context.Context, projectID string) (ProjectSummary, error) {
	sum := ProjectSummary{TypeCounts: map[string]int{}}

	rows, err := s.pool.Query(ctx, `
		SELECT st.name, st.category, count(i.id)
		FROM issues i JOIN statuses st ON st.id = i.status_id
		WHERE i.project_id = $1
		GROUP BY st.name, st.category, st.position ORDER BY st.position`, projectID)
	if err != nil {
		return sum, fmt.Errorf("status counts: %w", err)
	}
	for rows.Next() {
		var sc StatusCount
		if err := rows.Scan(&sc.Status, &sc.Category, &sc.Count); err != nil {
			rows.Close()
			return sum, err
		}
		sum.StatusCounts = append(sum.StatusCounts, sc)
		sum.Total += sc.Count
		if sc.Category == "done" {
			sum.Done += sc.Count
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return sum, err
	}
	sum.Open = sum.Total - sum.Done

	rows, err = s.pool.Query(ctx,
		`SELECT type, count(*) FROM issues WHERE project_id = $1 GROUP BY type`, projectID)
	if err != nil {
		return sum, fmt.Errorf("type counts: %w", err)
	}
	for rows.Next() {
		var t string
		var c int
		if err := rows.Scan(&t, &c); err != nil {
			rows.Close()
			return sum, err
		}
		sum.TypeCounts[t] = c
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return sum, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at, count(i.id)
		FROM issues i LEFT JOIN users u ON u.id = i.assignee_id
		WHERE i.project_id = $1 AND i.resolution IS NULL
		GROUP BY u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		ORDER BY count(i.id) DESC`, projectID)
	if err != nil {
		return sum, fmt.Errorf("workload: %w", err)
	}
	for rows.Next() {
		var id, email, name, avatar *string
		var active *bool
		var created *time.Time
		var entry WorkloadEntry
		if err := rows.Scan(&id, &email, &name, &avatar, &active, &created, &entry.OpenCount); err != nil {
			rows.Close()
			return sum, err
		}
		if id != nil {
			entry.User = &User{ID: *id, Email: *email, DisplayName: *name, AvatarURL: avatar, IsActive: *active, CreatedAt: *created}
		}
		sum.Workload = append(sum.Workload, entry)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return sum, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT p.key || '-' || i.number, i.summary, e.field, COALESCE(e.new_value::text, ''), e.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM issue_events e
		JOIN issues i ON i.id = e.issue_id
		JOIN projects p ON p.id = i.project_id
		JOIN users u ON u.id = e.actor_id
		WHERE i.project_id = $1
		ORDER BY e.created_at DESC LIMIT 15`, projectID)
	if err != nil {
		return sum, fmt.Errorf("activity: %w", err)
	}
	for rows.Next() {
		var a ActivityEntry
		if err := rows.Scan(&a.IssueKey, &a.IssueSummary, &a.Field, &a.NewValue, &a.CreatedAt,
			&a.Actor.ID, &a.Actor.Email, &a.Actor.DisplayName, &a.Actor.AvatarURL,
			&a.Actor.IsActive, &a.Actor.CreatedAt); err != nil {
			rows.Close()
			return sum, err
		}
		sum.Activity = append(sum.Activity, a)
	}
	rows.Close()
	return sum, rows.Err()
}
