package store

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// Reports power the space Reports tab (Jira parity). All queries are scoped
// to one project and return small aggregate payloads.

type ReportSlice struct {
	Name     string `json:"name"`
	Category string `json:"category,omitempty"` // status slices only
	Count    int64  `json:"count"`
	Seconds  int64  `json:"seconds,omitempty"` // workload estimate sum
}

type ReportOverview struct {
	Completed7 int64         `json:"completed7"`
	Updated7   int64         `json:"updated7"`
	Created7   int64         `json:"created7"`
	DueNext7   int64         `json:"dueNext7"`
	ByStatus   []ReportSlice `json:"byStatus"`
	ByType     []ReportSlice `json:"byType"`
	ByAssignee []ReportSlice `json:"byAssignee"`
	Total      int64         `json:"total"`
}

func (s *Store) ReportOverview(ctx context.Context, projectID string) (*ReportOverview, error) {
	o := &ReportOverview{}
	err := s.pool.QueryRow(ctx, `
		SELECT count(*),
		  count(*) FILTER (WHERE resolved_at >= now() - interval '7 days'),
		  count(*) FILTER (WHERE updated_at >= now() - interval '7 days'),
		  count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
		  count(*) FILTER (WHERE resolution IS NULL AND due_date >= now()::date AND due_date < now()::date + 7)
		FROM issues WHERE project_id = $1`, projectID).
		Scan(&o.Total, &o.Completed7, &o.Updated7, &o.Created7, &o.DueNext7)
	if err != nil {
		return nil, fmt.Errorf("report overview: %w", err)
	}
	if o.ByStatus, err = s.reportSlices(ctx, projectID, "status", 0); err != nil {
		return nil, err
	}
	if o.ByType, err = s.reportSlices(ctx, projectID, "type", 12); err != nil {
		return nil, err
	}
	if o.ByAssignee, err = s.reportSlices(ctx, projectID, "assignee", 12); err != nil {
		return nil, err
	}
	return o, nil
}

// reportSlices groups the project's issues by a dimension. cap>0 folds the
// tail into an "Other" slice (identity stays stable; hues are never cycled).
func (s *Store) reportSlices(ctx context.Context, projectID, field string, cap int) ([]ReportSlice, error) {
	var q string
	switch field {
	case "status":
		q = `SELECT st.name, st.category, count(*) FROM issues i
			JOIN statuses st ON st.id = i.status_id
			WHERE i.project_id = $1 GROUP BY st.name, st.category, st.position ORDER BY st.position`
	case "type":
		q = `SELECT COALESCE(wt.name, i.type), '', count(*) FROM issues i
			LEFT JOIN work_types wt ON wt.key = i.type
			WHERE i.project_id = $1 GROUP BY 1 ORDER BY 3 DESC`
	case "assignee":
		q = `SELECT COALESCE(u.display_name, 'Unassigned'), '', count(*) FROM issues i
			LEFT JOIN users u ON u.id = i.assignee_id
			WHERE i.project_id = $1 GROUP BY 1 ORDER BY 3 DESC`
	case "reporter":
		q = `SELECT COALESCE(u.display_name, 'Unknown'), '', count(*) FROM issues i
			LEFT JOIN users u ON u.id = i.reporter_id
			WHERE i.project_id = $1 GROUP BY 1 ORDER BY 3 DESC`
	case "priority":
		q = `SELECT initcap(i.priority), '', count(*) FROM issues i
			WHERE i.project_id = $1 GROUP BY 1 ORDER BY 3 DESC`
	case "label":
		q = `SELECT l.name, '', count(*) FROM issue_labels il
			JOIN labels l ON l.id = il.label_id
			JOIN issues i ON i.id = il.issue_id
			WHERE i.project_id = $1 GROUP BY 1 ORDER BY 3 DESC`
	case "component":
		q = `SELECT c.name, '', count(*) FROM issue_components ic
			JOIN components c ON c.id = ic.component_id
			JOIN issues i ON i.id = ic.issue_id
			WHERE i.project_id = $1 GROUP BY 1 ORDER BY 3 DESC`
	default:
		return nil, fmt.Errorf("unknown report field %q", field)
	}
	rows, err := s.pool.Query(ctx, q, projectID)
	if err != nil {
		return nil, fmt.Errorf("report slices %s: %w", field, err)
	}
	defer rows.Close()
	var out []ReportSlice
	for rows.Next() {
		var sl ReportSlice
		if err := rows.Scan(&sl.Name, &sl.Category, &sl.Count); err != nil {
			return nil, err
		}
		out = append(out, sl)
	}
	if cap > 0 && len(out) > cap {
		var other int64
		for _, sl := range out[cap:] {
			other += sl.Count
		}
		out = append(out[:cap], ReportSlice{Name: "Other", Count: other})
	}
	return out, rows.Err()
}

// ReportSlicesByField is the pie-chart entry point (uncapped slices).
func (s *Store) ReportSlicesByField(ctx context.Context, projectID, field string) ([]ReportSlice, error) {
	return s.reportSlices(ctx, projectID, field, 0)
}

// ReportGroupBy: one row per group with status-category breakdown.
type ReportGroup struct {
	Name       string `json:"name"`
	Total      int64  `json:"total"`
	Todo       int64  `json:"todo"`
	InProgress int64  `json:"inProgress"`
	Done       int64  `json:"done"`
}

func (s *Store) ReportGroupBy(ctx context.Context, projectID, field string) ([]ReportGroup, error) {
	var dim, join string
	switch field {
	case "status":
		dim, join = "st.name", ""
	case "type":
		dim, join = "COALESCE(wt.name, i.type)", "LEFT JOIN work_types wt ON wt.key = i.type"
	case "assignee":
		dim, join = "COALESCE(u.display_name, 'Unassigned')", "LEFT JOIN users u ON u.id = i.assignee_id"
	case "reporter":
		dim, join = "COALESCE(u.display_name, 'Unknown')", "LEFT JOIN users u ON u.id = i.reporter_id"
	case "priority":
		dim = "initcap(i.priority)"
	case "component":
		dim, join = "c.name", "JOIN issue_components ic ON ic.issue_id = i.id JOIN components c ON c.id = ic.component_id"
	case "label":
		dim, join = "l.name", "JOIN issue_labels il ON il.issue_id = i.id JOIN labels l ON l.id = il.label_id"
	default:
		return nil, fmt.Errorf("unknown report field %q", field)
	}
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT %s AS dim, count(*),
		  count(*) FILTER (WHERE st.category = 'todo'),
		  count(*) FILTER (WHERE st.category = 'in_progress'),
		  count(*) FILTER (WHERE st.category = 'done')
		FROM issues i JOIN statuses st ON st.id = i.status_id %s
		WHERE i.project_id = $1 GROUP BY dim ORDER BY 2 DESC, dim`, dim, join), projectID)
	if err != nil {
		return nil, fmt.Errorf("report groupby %s: %w", field, err)
	}
	defer rows.Close()
	var out []ReportGroup
	for rows.Next() {
		var g ReportGroup
		if err := rows.Scan(&g.Name, &g.Total, &g.Todo, &g.InProgress, &g.Done); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ReportBucket is one time bucket in a trend report.
type ReportBucket struct {
	Date     string  `json:"date"` // bucket start, YYYY-MM-DD
	Created  int64   `json:"created,omitempty"`
	Resolved int64   `json:"resolved,omitempty"`
	Count    int64   `json:"count,omitempty"`
	Avg      float64 `json:"avg,omitempty"` // days
}

func bucketInterval(days int) string {
	switch {
	case days <= 45:
		return "day"
	case days <= 240:
		return "week"
	default:
		return "month"
	}
}

// ReportCreatedVsResolved: created and resolved counts per bucket.
func (s *Store) ReportCreatedVsResolved(ctx context.Context, projectID string, days int) ([]ReportBucket, string, error) {
	iv := bucketInterval(days)
	rows, err := s.pool.Query(ctx, `
		WITH buckets AS (
		  SELECT generate_series(date_trunc($3, now() - ($2 || ' days')::interval),
		                         date_trunc($3, now()), ('1 ' || $3)::interval) AS b
		)
		SELECT to_char(b, 'YYYY-MM-DD'),
		  (SELECT count(*) FROM issues i WHERE i.project_id = $1
		     AND date_trunc($3, i.created_at) = b),
		  (SELECT count(*) FROM issues i WHERE i.project_id = $1
		     AND i.resolved_at IS NOT NULL AND date_trunc($3, i.resolved_at) = b)
		FROM buckets ORDER BY b`, projectID, fmt.Sprint(days), iv)
	if err != nil {
		return nil, iv, fmt.Errorf("created vs resolved: %w", err)
	}
	defer rows.Close()
	var out []ReportBucket
	for rows.Next() {
		var b ReportBucket
		if err := rows.Scan(&b.Date, &b.Created, &b.Resolved); err != nil {
			return nil, iv, err
		}
		out = append(out, b)
	}
	return out, iv, rows.Err()
}

// ReportRecentlyCreated: per bucket, how many were created and how many of
// those are resolved today.
func (s *Store) ReportRecentlyCreated(ctx context.Context, projectID string, days int) ([]ReportBucket, string, error) {
	iv := bucketInterval(days)
	rows, err := s.pool.Query(ctx, `
		SELECT to_char(date_trunc($3, i.created_at), 'YYYY-MM-DD'),
		  count(*), count(*) FILTER (WHERE i.resolution IS NOT NULL)
		FROM issues i
		WHERE i.project_id = $1 AND i.created_at >= now() - ($2 || ' days')::interval
		GROUP BY 1 ORDER BY 1`, projectID, fmt.Sprint(days), iv)
	if err != nil {
		return nil, iv, fmt.Errorf("recently created: %w", err)
	}
	defer rows.Close()
	var out []ReportBucket
	for rows.Next() {
		var b ReportBucket
		if err := rows.Scan(&b.Date, &b.Created, &b.Resolved); err != nil {
			return nil, iv, err
		}
		out = append(out, b)
	}
	return out, iv, rows.Err()
}

// ReportResolutionTime: average days from created to resolved, per bucket of
// resolution date.
func (s *Store) ReportResolutionTime(ctx context.Context, projectID string, days int) ([]ReportBucket, string, error) {
	iv := bucketInterval(days)
	rows, err := s.pool.Query(ctx, `
		SELECT to_char(date_trunc($3, i.resolved_at), 'YYYY-MM-DD'), count(*),
		  avg(EXTRACT(epoch FROM i.resolved_at - i.created_at)) / 86400
		FROM issues i
		WHERE i.project_id = $1 AND i.resolved_at >= now() - ($2 || ' days')::interval
		GROUP BY 1 ORDER BY 1`, projectID, fmt.Sprint(days), iv)
	if err != nil {
		return nil, iv, fmt.Errorf("resolution time: %w", err)
	}
	defer rows.Close()
	var out []ReportBucket
	for rows.Next() {
		var b ReportBucket
		if err := rows.Scan(&b.Date, &b.Count, &b.Avg); err != nil {
			return nil, iv, err
		}
		out = append(out, b)
	}
	return out, iv, rows.Err()
}

// ReportAverageAge: sampled average age (days) of unresolved items.
func (s *Store) ReportAverageAge(ctx context.Context, projectID string, days int) ([]ReportBucket, string, error) {
	iv := bucketInterval(days)
	rows, err := s.pool.Query(ctx, `
		WITH samples AS (
		  SELECT generate_series(date_trunc($3, now() - ($2 || ' days')::interval),
		                         date_trunc($3, now()), ('1 ' || $3)::interval) AS d
		)
		SELECT to_char(d, 'YYYY-MM-DD'),
		  count(i.id),
		  COALESCE(avg(EXTRACT(epoch FROM d - i.created_at)) / 86400, 0)
		FROM samples LEFT JOIN issues i
		  ON i.project_id = $1 AND i.created_at <= d
		  AND (i.resolved_at IS NULL OR i.resolved_at > d)
		GROUP BY d ORDER BY d`, projectID, fmt.Sprint(days), iv)
	if err != nil {
		return nil, iv, fmt.Errorf("average age: %w", err)
	}
	defer rows.Close()
	var out []ReportBucket
	for rows.Next() {
		var b ReportBucket
		if err := rows.Scan(&b.Date, &b.Count, &b.Avg); err != nil {
			return nil, iv, err
		}
		out = append(out, b)
	}
	return out, iv, rows.Err()
}

// ReportTimeSince: counts of issues per bucket of a chosen date field.
func (s *Store) ReportTimeSince(ctx context.Context, projectID, field string, days int) ([]ReportBucket, string, error) {
	var col string
	switch field {
	case "created":
		col = "i.created_at"
	case "updated":
		col = "i.updated_at"
	case "resolved":
		col = "i.resolved_at"
	case "due":
		col = "i.due_date"
	default:
		return nil, "", fmt.Errorf("unknown date field %q", field)
	}
	iv := bucketInterval(days)
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT to_char(date_trunc($3, %s), 'YYYY-MM-DD'), count(*)
		FROM issues i
		WHERE i.project_id = $1 AND %s IS NOT NULL AND %s >= now() - ($2 || ' days')::interval
		GROUP BY 1 ORDER BY 1`, col, col, col), projectID, fmt.Sprint(days), iv)
	if err != nil {
		return nil, iv, fmt.Errorf("time since: %w", err)
	}
	defer rows.Close()
	var out []ReportBucket
	for rows.Next() {
		var b ReportBucket
		if err := rows.Scan(&b.Date, &b.Count); err != nil {
			return nil, iv, err
		}
		out = append(out, b)
	}
	return out, iv, rows.Err()
}

// ReportWorkload: per-assignee issue counts and remaining estimate.
func (s *Store) ReportWorkload(ctx context.Context, projectID string) ([]ReportSlice, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT COALESCE(u.display_name, 'Unassigned'), count(*),
		  COALESCE(sum(COALESCE(i.remaining_estimate_seconds, i.original_estimate_seconds, 0)), 0)
		FROM issues i LEFT JOIN users u ON u.id = i.assignee_id
		WHERE i.project_id = $1 AND i.resolution IS NULL
		GROUP BY 1 ORDER BY 2 DESC`, projectID)
	if err != nil {
		return nil, fmt.Errorf("workload: %w", err)
	}
	defer rows.Close()
	var out []ReportSlice
	for rows.Next() {
		var sl ReportSlice
		if err := rows.Scan(&sl.Name, &sl.Count, &sl.Seconds); err != nil {
			return nil, err
		}
		out = append(out, sl)
	}
	return out, rows.Err()
}

// --- Cumulative flow + control chart (status-history replay) ---

type CFDDay struct {
	Date       string `json:"date"`
	Todo       int64  `json:"todo"`
	InProgress int64  `json:"inProgress"`
	Done       int64  `json:"done"`
}

type statusChange struct {
	at  time.Time
	cat string
}

// reportStatusTimelines rebuilds each issue's status-category timeline from
// issue_events (field='status', values are status names).
func (s *Store) reportStatusTimelines(ctx context.Context, projectID string) (map[string][]statusChange, error) {
	catByName := map[string]string{}
	rows, err := s.pool.Query(ctx, `
		SELECT st.name, st.category FROM statuses st
		JOIN projects p ON p.workflow_id = st.workflow_id WHERE p.id = $1`, projectID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name, cat string
		if err := rows.Scan(&name, &cat); err != nil {
			rows.Close()
			return nil, err
		}
		catByName[name] = cat
	}
	rows.Close()

	timelines := map[string][]statusChange{}
	rows, err = s.pool.Query(ctx, `
		SELECT i.id, i.created_at, st.category FROM issues i
		JOIN statuses st ON st.id = i.status_id WHERE i.project_id = $1`, projectID)
	if err != nil {
		return nil, err
	}
	currentCat := map[string]string{}
	for rows.Next() {
		var id, cat string
		var created time.Time
		if err := rows.Scan(&id, &created, &cat); err != nil {
			rows.Close()
			return nil, err
		}
		timelines[id] = []statusChange{{at: created, cat: ""}} // cat filled below
		currentCat[id] = cat
	}
	rows.Close()

	rows, err = s.pool.Query(ctx, `
		SELECT e.issue_id, e.created_at, e.old_value #>> '{}', e.new_value #>> '{}'
		FROM issue_events e JOIN issues i ON i.id = e.issue_id
		WHERE i.project_id = $1 AND e.field = 'status'
		ORDER BY e.created_at`, projectID)
	if err != nil {
		return nil, err
	}
	firstOld := map[string]string{}
	for rows.Next() {
		var id string
		var at time.Time
		var oldV, newV *string
		if err := rows.Scan(&id, &at, &oldV, &newV); err != nil {
			rows.Close()
			return nil, err
		}
		if _, ok := timelines[id]; !ok {
			continue
		}
		if _, seen := firstOld[id]; !seen && oldV != nil {
			firstOld[id] = *oldV
		}
		cat := ""
		if newV != nil {
			cat = catByName[*newV]
		}
		if cat == "" {
			continue
		}
		timelines[id] = append(timelines[id], statusChange{at: at, cat: cat})
	}
	rows.Close()

	// Initial category: the first status event's old value when known,
	// otherwise the current status (never transitioned).
	for id, tl := range timelines {
		initial := currentCat[id]
		if old, ok := firstOld[id]; ok {
			if c := catByName[old]; c != "" {
				initial = c
			} else {
				initial = "todo"
			}
		}
		tl[0].cat = initial
		timelines[id] = tl
	}
	return timelines, nil
}

// ReportCumulativeFlow: daily counts of issues per status category.
func (s *Store) ReportCumulativeFlow(ctx context.Context, projectID string, days int) ([]CFDDay, error) {
	timelines, err := s.reportStatusTimelines(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("cumulative flow: %w", err)
	}
	var out []CFDDay
	end := time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	for d := end.AddDate(0, 0, -days); !d.After(end); d = d.AddDate(0, 0, 1) {
		day := CFDDay{Date: d.Format("2006-01-02")}
		for _, tl := range timelines {
			if tl[0].at.After(d) {
				continue
			}
			cat := tl[0].cat
			for _, ch := range tl[1:] {
				if ch.at.After(d) {
					break
				}
				cat = ch.cat
			}
			switch cat {
			case "in_progress":
				day.InProgress++
			case "done":
				day.Done++
			default:
				day.Todo++
			}
		}
		out = append(out, day)
	}
	return out, nil
}

type CycleTimePoint struct {
	Key       string  `json:"key"`
	Summary   string  `json:"summary"`
	Completed string  `json:"completed"` // YYYY-MM-DD
	Days      float64 `json:"days"`
}

// ReportCycleTime: for each item resolved in the window, days from the first
// move into an in-progress status (falling back to creation) to resolution.
func (s *Store) ReportCycleTime(ctx context.Context, projectID string, days int) ([]CycleTimePoint, error) {
	timelines, err := s.reportStatusTimelines(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("cycle time: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, p.key || '-' || i.number, i.summary, i.created_at, i.resolved_at
		FROM issues i JOIN projects p ON p.id = i.project_id
		WHERE i.project_id = $1 AND i.resolved_at >= now() - ($2 || ' days')::interval
		ORDER BY i.resolved_at`, projectID, fmt.Sprint(days))
	if err != nil {
		return nil, fmt.Errorf("cycle time: %w", err)
	}
	defer rows.Close()
	var out []CycleTimePoint
	for rows.Next() {
		var id, key, summary string
		var created, resolved time.Time
		if err := rows.Scan(&id, &key, &summary, &created, &resolved); err != nil {
			return nil, err
		}
		start := created
		for _, ch := range timelines[id] {
			if ch.cat == "in_progress" {
				if ch.at.After(created) {
					start = ch.at
				}
				break
			}
		}
		d := resolved.Sub(start).Hours() / 24
		if d < 0 {
			d = 0
		}
		out = append(out, CycleTimePoint{Key: key, Summary: summary,
			Completed: resolved.Format("2006-01-02"), Days: d})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Completed < out[j].Completed })
	return out, rows.Err()
}
