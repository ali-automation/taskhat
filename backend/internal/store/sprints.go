package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrSprintActive = errors.New("another sprint is already active on this board")

type Sprint struct {
	ID          string     `json:"id"`
	BoardID     string     `json:"boardId"`
	Name        string     `json:"name"`
	Goal        string     `json:"goal"`
	State       string     `json:"state"` // future | active | closed
	StartAt     *time.Time `json:"startAt"`
	EndAt       *time.Time `json:"endAt"`
	CompletedAt *time.Time `json:"completedAt"`
}

const sprintCols = `id, board_id, name, goal, state, start_at, end_at, completed_at`

func scanSprint(row pgx.Row) (Sprint, error) {
	var s Sprint
	err := row.Scan(&s.ID, &s.BoardID, &s.Name, &s.Goal, &s.State, &s.StartAt, &s.EndAt, &s.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Sprint{}, ErrNotFound
	}
	return s, err
}

func (s *Store) GetSprint(ctx context.Context, id string) (Sprint, error) {
	return scanSprint(s.pool.QueryRow(ctx, `SELECT `+sprintCols+` FROM sprints WHERE id = $1`, id))
}

// ListSprints returns a board's sprints: active first, then future by
// creation, then (optionally) closed, newest first.
func (s *Store) ListSprints(ctx context.Context, boardID string, includeClosed bool) ([]Sprint, error) {
	q := `SELECT ` + sprintCols + ` FROM sprints WHERE board_id = $1`
	if !includeClosed {
		q += ` AND state <> 'closed'`
	}
	q += ` ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'future' THEN 1 ELSE 2 END, created_at`
	rows, err := s.pool.Query(ctx, q, boardID)
	if err != nil {
		return nil, fmt.Errorf("list sprints: %w", err)
	}
	defer rows.Close()
	sprints := []Sprint{}
	for rows.Next() {
		sp, err := scanSprint(rows)
		if err != nil {
			return nil, err
		}
		sprints = append(sprints, sp)
	}
	return sprints, rows.Err()
}

// CreateSprint makes a future sprint named "<KEY> Sprint N", like Jira.
func (s *Store) CreateSprint(ctx context.Context, boardID string) (Sprint, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO sprints (board_id, name)
		SELECT b.id, p.key || ' Sprint ' || (SELECT count(*) + 1 FROM sprints WHERE board_id = b.id)
		FROM boards b JOIN projects p ON p.id = b.project_id
		WHERE b.id = $1
		RETURNING id`, boardID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Sprint{}, ErrNotFound
	}
	if err != nil {
		return Sprint{}, fmt.Errorf("create sprint: %w", err)
	}
	return s.GetSprint(ctx, id)
}

func (s *Store) UpdateSprint(ctx context.Context, id, name, goal string) (Sprint, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE sprints SET name = $2, goal = $3 WHERE id = $1`, id, name, goal)
	if err != nil {
		return Sprint{}, fmt.Errorf("update sprint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Sprint{}, ErrNotFound
	}
	return s.GetSprint(ctx, id)
}

// DeleteSprint removes a future sprint; its issues return to the backlog.
func (s *Store) DeleteSprint(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM sprints WHERE id = $1 AND state = 'future'`, id)
	if err != nil {
		return fmt.Errorf("delete sprint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) StartSprint(ctx context.Context, id, name, goal string, startAt, endAt time.Time) (Sprint, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE sprints SET state = 'active', name = $2, goal = $3, start_at = $4, end_at = $5
		WHERE id = $1 AND state = 'future'`, id, name, goal, startAt, endAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return Sprint{}, ErrSprintActive
	}
	if err != nil {
		return Sprint{}, fmt.Errorf("start sprint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Sprint{}, ErrNotFound
	}
	return s.GetSprint(ctx, id)
}

// CompleteSprint closes the sprint. Issues not in a done status roll over to
// moveToSprintID (nil = backlog); done issues stay attached to the closed
// sprint — exactly Jira's behavior.
func (s *Store) CompleteSprint(ctx context.Context, id string, moveToSprintID *string) (Sprint, int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Sprint{}, 0, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	sp, err := scanSprint(tx.QueryRow(ctx,
		`SELECT `+sprintCols+` FROM sprints WHERE id = $1 AND state = 'active' FOR UPDATE`, id))
	if err != nil {
		return Sprint{}, 0, err
	}

	tag, err := tx.Exec(ctx, `
		UPDATE issues SET sprint_id = $2, updated_at = now()
		WHERE sprint_id = $1
		  AND status_id IN (SELECT id FROM statuses WHERE category <> 'done')`,
		id, moveToSprintID)
	if err != nil {
		return Sprint{}, 0, fmt.Errorf("roll over issues: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE sprints SET state = 'closed', completed_at = now() WHERE id = $1`, id); err != nil {
		return Sprint{}, 0, fmt.Errorf("close sprint: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Sprint{}, 0, fmt.Errorf("commit: %w", err)
	}
	closed, err := s.GetSprint(ctx, sp.ID)
	return closed, int(tag.RowsAffected()), err
}

type EpicStats struct {
	ID      string  `json:"id"`
	Key     string  `json:"key"`
	Summary string  `json:"summary"`
	Done    int     `json:"done"`
	Total   int     `json:"total"`
	Points  float64 `json:"points"`
}

// ListEpics returns a project's epics with child progress for the epic panel.
func (s *Store) ListEpics(ctx context.Context, projectID string) ([]EpicStats, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, p.key || '-' || e.number, e.summary,
		       count(c.id) FILTER (WHERE st.category = 'done'),
		       count(c.id),
		       COALESCE(sum(c.story_points), 0)
		FROM issues e
		JOIN projects p ON p.id = e.project_id
		LEFT JOIN issues c ON c.parent_id = e.id
		LEFT JOIN statuses st ON st.id = c.status_id
		WHERE e.project_id = $1 AND e.type = 'epic'
		GROUP BY e.id, p.key
		ORDER BY e.rank`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list epics: %w", err)
	}
	defer rows.Close()
	epics := []EpicStats{}
	for rows.Next() {
		var e EpicStats
		if err := rows.Scan(&e.ID, &e.Key, &e.Summary, &e.Done, &e.Total, &e.Points); err != nil {
			return nil, err
		}
		epics = append(epics, e)
	}
	return epics, rows.Err()
}

// ListChildren returns an issue's direct children (epic issues or sub-tasks).
func (s *Store) ListChildren(ctx context.Context, parentID string) ([]Issue, error) {
	rows, err := s.pool.Query(ctx, issueSelect+` WHERE i.parent_id = $1 ORDER BY i.rank`, parentID)
	if err != nil {
		return nil, fmt.Errorf("list children: %w", err)
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

type BurndownPoint struct {
	Date      string  `json:"date"`
	Remaining float64 `json:"remaining"`
	Ideal     float64 `json:"ideal"`
}

// Burndown computes remaining story points per day of the sprint from
// resolved_at timestamps. Issues without points count as 0.
func (s *Store) Burndown(ctx context.Context, sprintID string) ([]BurndownPoint, float64, error) {
	sp, err := s.GetSprint(ctx, sprintID)
	if err != nil {
		return nil, 0, err
	}
	if sp.StartAt == nil || sp.EndAt == nil {
		return []BurndownPoint{}, 0, nil
	}

	rows, err := s.pool.Query(ctx,
		`SELECT COALESCE(story_points, 0), resolved_at FROM issues WHERE sprint_id = $1`, sprintID)
	if err != nil {
		return nil, 0, fmt.Errorf("burndown issues: %w", err)
	}
	defer rows.Close()
	type item struct {
		points     float64
		resolvedAt *time.Time
	}
	var items []item
	var total float64
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.points, &it.resolvedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, it)
		total += it.points
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	start := sp.StartAt.Truncate(24 * time.Hour)
	end := sp.EndAt.Truncate(24 * time.Hour)
	days := int(end.Sub(start).Hours()/24) + 1
	if days < 2 {
		days = 2
	}
	today := time.Now().UTC()

	points := []BurndownPoint{}
	for d := 0; d < days; d++ {
		day := start.AddDate(0, 0, d)
		endOfDay := day.Add(24 * time.Hour)
		ideal := total * float64(days-1-d) / float64(days-1)
		bp := BurndownPoint{Date: day.Format("2006-01-02"), Ideal: ideal, Remaining: -1}
		if day.Before(today) || day.Equal(today) || d == 0 {
			remaining := total
			for _, it := range items {
				if it.resolvedAt != nil && it.resolvedAt.Before(endOfDay) {
					remaining -= it.points
				}
			}
			bp.Remaining = remaining
		}
		points = append(points, bp)
	}
	return points, total, nil
}
