package store

import (
	"context"
	"fmt"
	"time"
)

// ---- Stage 20: Timeline (Gantt) view ----

// TimelineItem is one row on the timeline: an epic or a schedulable work item.
type TimelineItem struct {
	ID             string     `json:"id"`
	Key            string     `json:"key"`
	Summary        string     `json:"summary"`
	Type           string     `json:"type"`
	StatusName     string     `json:"statusName"`
	StatusCategory string     `json:"statusCategory"`
	ParentKey      *string    `json:"parentKey"`
	StartDate      *time.Time `json:"startDate"`
	DueDate        *time.Time `json:"dueDate"`
}

// TimelineLink is a "blocks" dependency between two timeline items.
type TimelineLink struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// TimelineItems returns every non-subtask work item in rank order, with the
// fields the timeline needs (subtasks are too granular for a roadmap).
func (s *Store) TimelineItems(ctx context.Context, projectID string) ([]TimelineItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, p.key || '-' || i.number, i.summary, i.type, st.name, st.category,
		       pp.key || '-' || par.number, i.start_date, i.due_date
		FROM issues i
		JOIN projects p ON p.id = i.project_id
		JOIN statuses st ON st.id = i.status_id
		LEFT JOIN issues par ON par.id = i.parent_id
		LEFT JOIN projects pp ON pp.id = par.project_id
		WHERE i.project_id = $1 AND i.type <> 'subtask'
		ORDER BY i.rank, i.created_at`, projectID)
	if err != nil {
		return nil, fmt.Errorf("timeline items: %w", err)
	}
	defer rows.Close()
	items := []TimelineItem{}
	for rows.Next() {
		var it TimelineItem
		if err := rows.Scan(&it.ID, &it.Key, &it.Summary, &it.Type, &it.StatusName, &it.StatusCategory,
			&it.ParentKey, &it.StartDate, &it.DueDate); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// TimelineLinks returns "blocks" dependencies where both ends live in the project.
func (s *Store) TimelineLinks(ctx context.Context, projectID string) ([]TimelineLink, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT pa.key || '-' || a.number, pb.key || '-' || b.number
		FROM issue_links l
		JOIN issues a ON a.id = l.from_issue_id
		JOIN issues b ON b.id = l.to_issue_id
		JOIN projects pa ON pa.id = a.project_id
		JOIN projects pb ON pb.id = b.project_id
		WHERE l.link_type = 'blocks' AND a.project_id = $1 AND b.project_id = $1`, projectID)
	if err != nil {
		return nil, fmt.Errorf("timeline links: %w", err)
	}
	defer rows.Close()
	links := []TimelineLink{}
	for rows.Next() {
		var l TimelineLink
		if err := rows.Scan(&l.From, &l.To); err != nil {
			return nil, err
		}
		links = append(links, l)
	}
	return links, rows.Err()
}
