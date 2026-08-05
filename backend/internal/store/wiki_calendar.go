package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage W14: team calendars ----

var CalendarColors = map[string]bool{
	"blue": true, "green": true, "purple": true, "red": true,
	"orange": true, "teal": true, "gray": true,
}

type WikiCalendarEvent struct {
	ID          string    `json:"id"`
	SpaceID     string    `json:"-"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	StartDate   time.Time `json:"startDate"`
	EndDate     time.Time `json:"endDate"`
	Color       string    `json:"color"`
	Author      *User     `json:"author"`
}

func (s *Store) ListWikiCalendarEvents(ctx context.Context, spaceID string, from, to time.Time) ([]WikiCalendarEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.space_id, e.title, e.description, e.start_date, e.end_date, e.color,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_calendar_events e LEFT JOIN users u ON u.id = e.created_by
		WHERE e.space_id = $1 AND e.start_date <= $3 AND e.end_date >= $2
		ORDER BY e.start_date, e.title`, spaceID, from, to)
	if err != nil {
		return nil, fmt.Errorf("calendar events: %w", err)
	}
	defer rows.Close()
	events := []WikiCalendarEvent{}
	for rows.Next() {
		var e WikiCalendarEvent
		var uid, uemail, uname, uavatar *string
		var uactive *bool
		var ucreated *time.Time
		if err := rows.Scan(&e.ID, &e.SpaceID, &e.Title, &e.Description, &e.StartDate, &e.EndDate, &e.Color,
			&uid, &uemail, &uname, &uavatar, &uactive, &ucreated); err != nil {
			return nil, err
		}
		e.Author = scanNullableUser(uid, uemail, uname, uavatar, uactive, ucreated)
		events = append(events, e)
	}
	return events, rows.Err()
}

func (s *Store) CreateWikiCalendarEvent(ctx context.Context, spaceID, title, description string, start, end time.Time, color, userID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_calendar_events (space_id, title, description, start_date, end_date, color, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		spaceID, title, description, start, end, color, userID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create calendar event: %w", err)
	}
	return id, nil
}

func (s *Store) UpdateWikiCalendarEvent(ctx context.Context, id, title, description string, start, end time.Time, color string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE wiki_calendar_events
		SET title = $2, description = $3, start_date = $4, end_date = $5, color = $6, updated_at = now()
		WHERE id = $1`, id, title, description, start, end, color)
	if err != nil {
		return fmt.Errorf("update calendar event: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteWikiCalendarEvent(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM wiki_calendar_events WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete calendar event: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// WikiCalendarEventSpace resolves an event to its space for role gates.
func (s *Store) WikiCalendarEventSpace(ctx context.Context, id string) (string, error) {
	var spaceID string
	err := s.pool.QueryRow(ctx, `SELECT space_id FROM wiki_calendar_events WHERE id = $1`, id).Scan(&spaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return spaceID, err
}

// ---- the TaskHat feed: due work items + sprint start/end ----

type CalendarDueItem struct {
	Key      string    `json:"key"`
	Summary  string    `json:"summary"`
	Type     string    `json:"type"`
	DueDate  time.Time `json:"dueDate"`
	Resolved bool      `json:"resolved"`
}

// CalendarDueItems lists work items due in the range across projects the
// viewer is a member of (archived spaces excluded).
func (s *Store) CalendarDueItems(ctx context.Context, userID string, from, to time.Time) ([]CalendarDueItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.key || '-' || i.number, i.summary, i.type, i.due_date, i.resolution IS NOT NULL
		FROM issues i
		JOIN projects p ON p.id = i.project_id
		JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
		WHERE i.due_date BETWEEN $2 AND $3 AND p.archived_at IS NULL
		ORDER BY i.due_date, p.key, i.number`, userID, from, to)
	if err != nil {
		return nil, fmt.Errorf("calendar due items: %w", err)
	}
	defer rows.Close()
	items := []CalendarDueItem{}
	for rows.Next() {
		var it CalendarDueItem
		if err := rows.Scan(&it.Key, &it.Summary, &it.Type, &it.DueDate, &it.Resolved); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

type CalendarSprint struct {
	Name       string     `json:"name"`
	ProjectKey string     `json:"projectKey"`
	State      string     `json:"state"`
	StartAt    *time.Time `json:"startAt"`
	EndAt      *time.Time `json:"endAt"`
}

// CalendarSprints lists sprints whose start or end falls in the range,
// scoped to the viewer's projects.
func (s *Store) CalendarSprints(ctx context.Context, userID string, from, to time.Time) ([]CalendarSprint, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT sp.name, p.key, sp.state, sp.start_at, sp.end_at
		FROM sprints sp
		JOIN boards b ON b.id = sp.board_id
		JOIN projects p ON p.id = b.project_id
		JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
		WHERE p.archived_at IS NULL
		  AND ((sp.start_at IS NOT NULL AND sp.start_at::date BETWEEN $2 AND $3)
		    OR (sp.end_at IS NOT NULL AND sp.end_at::date BETWEEN $2 AND $3))
		ORDER BY sp.start_at NULLS LAST`, userID, from, to)
	if err != nil {
		return nil, fmt.Errorf("calendar sprints: %w", err)
	}
	defer rows.Close()
	sprints := []CalendarSprint{}
	for rows.Next() {
		var sp CalendarSprint
		if err := rows.Scan(&sp.Name, &sp.ProjectKey, &sp.State, &sp.StartAt, &sp.EndAt); err != nil {
			return nil, err
		}
		sprints = append(sprints, sp)
	}
	return sprints, rows.Err()
}
