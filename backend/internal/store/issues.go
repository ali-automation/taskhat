package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ali-automation/taskhat/backend/internal/rank"
)

type Issue struct {
	ID             string          `json:"id"`
	Key            string          `json:"key"`
	ProjectID      string          `json:"-"`
	ProjectKey     string          `json:"projectKey"`
	ProjectName    string          `json:"projectName"`
	WorkflowID     string          `json:"-"`
	Number         int64           `json:"-"`
	Type           string          `json:"type"`
	Summary        string          `json:"summary"`
	Description    string          `json:"description"`
	DescriptionDoc json.RawMessage `json:"descriptionDoc"` // TipTap JSON; nil = plain text
	Status         Status          `json:"status"`
	Priority       string          `json:"priority"`
	Assignee       *User           `json:"assignee"`
	Reporter       User            `json:"reporter"`
	Labels         []string        `json:"labels"`
	StoryPoints    *float64        `json:"storyPoints"`
	Sprint         *SprintRef      `json:"sprint"`
	Parent         *IssueRef       `json:"parent"`
	StartDate      *time.Time      `json:"startDate"`
	DueDate        *time.Time      `json:"dueDate"`
	Resolution     *string         `json:"resolution"`
	ResolvedAt     *time.Time      `json:"resolvedAt"`
	Rank           string          `json:"-"`
	FixVersions    []VersionRef    `json:"fixVersions"`
	OriginalEstimateSeconds  *int64 `json:"originalEstimateSeconds"`
	RemainingEstimateSeconds *int64 `json:"remainingEstimateSeconds"`
	TimeSpentSeconds         int64  `json:"timeSpentSeconds"`
	Custom         map[string]any  `json:"custom"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type SprintRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

type IssueRef struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Summary string `json:"summary"`
	Type    string `json:"type"`
}

type IssueEvent struct {
	ID        string          `json:"id"`
	Actor     User            `json:"actor"`
	Field     string          `json:"field"`
	OldValue  json.RawMessage `json:"oldValue"`
	NewValue  json.RawMessage `json:"newValue"`
	CreatedAt time.Time       `json:"createdAt"`
}

const issueSelect = `
SELECT i.id, p.key || '-' || i.number, i.project_id, p.key, p.name, p.workflow_id, i.number,
       i.type, i.summary, i.description, i.description_doc, i.priority, i.start_date, i.due_date, i.resolution, i.resolved_at,
       i.rank, i.created_at, i.updated_at, i.story_points,
       s.id, s.name, s.category, s.position,
       r.id, r.email, r.display_name, r.avatar_url, r.is_active, r.created_at,
       a.id, a.email, a.display_name, a.avatar_url, a.is_active, a.created_at,
       sp.id, sp.name, sp.state,
       par.id, p.key || '-' || par.number, par.summary, par.type,
       COALESCE((SELECT array_agg(l.name ORDER BY l.name)
                 FROM issue_labels il JOIN labels l ON l.id = il.label_id
                 WHERE il.issue_id = i.id), '{}'),
       COALESCE((SELECT jsonb_object_agg(v.field_id, v.value)
                 FROM issue_field_values v WHERE v.issue_id = i.id), '{}'),
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ver.id, 'name', ver.name, 'status', ver.status) ORDER BY ver.name)
                 FROM issue_fix_versions ifv JOIN versions ver ON ver.id = ifv.version_id
                 WHERE ifv.issue_id = i.id), '[]'),
       i.original_estimate_seconds, i.remaining_estimate_seconds,
       COALESCE((SELECT sum(wl.seconds) FROM worklogs wl WHERE wl.issue_id = i.id), 0)
FROM issues i
JOIN projects p ON p.id = i.project_id
JOIN statuses s ON s.id = i.status_id
JOIN users r ON r.id = i.reporter_id
LEFT JOIN users a ON a.id = i.assignee_id
LEFT JOIN sprints sp ON sp.id = i.sprint_id
LEFT JOIN issues par ON par.id = i.parent_id
`

func scanIssue(row pgx.Row) (Issue, error) {
	var i Issue
	var fvRaw []byte
	var assigneeID, assigneeEmail, assigneeName, assigneeAvatar *string
	var assigneeActive *bool
	var assigneeCreated *time.Time
	var sprintID, sprintName, sprintState *string
	var parentID, parentKey, parentSummary, parentType *string
	err := row.Scan(
		&i.ID, &i.Key, &i.ProjectID, &i.ProjectKey, &i.ProjectName, &i.WorkflowID, &i.Number,
		&i.Type, &i.Summary, &i.Description, &i.DescriptionDoc, &i.Priority, &i.StartDate, &i.DueDate, &i.Resolution, &i.ResolvedAt,
		&i.Rank, &i.CreatedAt, &i.UpdatedAt, &i.StoryPoints,
		&i.Status.ID, &i.Status.Name, &i.Status.Category, &i.Status.Position,
		&i.Reporter.ID, &i.Reporter.Email, &i.Reporter.DisplayName, &i.Reporter.AvatarURL,
		&i.Reporter.IsActive, &i.Reporter.CreatedAt,
		&assigneeID, &assigneeEmail, &assigneeName, &assigneeAvatar, &assigneeActive, &assigneeCreated,
		&sprintID, &sprintName, &sprintState,
		&parentID, &parentKey, &parentSummary, &parentType,
		&i.Labels,
		&i.Custom,
		&fvRaw,
		&i.OriginalEstimateSeconds, &i.RemainingEstimateSeconds, &i.TimeSpentSeconds,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Issue{}, ErrNotFound
	}
	if err != nil {
		return Issue{}, err
	}
	if assigneeID != nil {
		i.Assignee = &User{
			ID: *assigneeID, Email: *assigneeEmail, DisplayName: *assigneeName,
			AvatarURL: assigneeAvatar, IsActive: *assigneeActive, CreatedAt: *assigneeCreated,
		}
	}
	if sprintID != nil {
		i.Sprint = &SprintRef{ID: *sprintID, Name: *sprintName, State: *sprintState}
	}
	if parentID != nil {
		i.Parent = &IssueRef{ID: *parentID, Key: *parentKey, Summary: *parentSummary, Type: *parentType}
	}
	i.FixVersions = []VersionRef{}
	_ = json.Unmarshal(fvRaw, &i.FixVersions)
	return i, nil
}

func jsonVal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

type NewIssue struct {
	ProjectID      string
	Type           string
	Summary        string
	Description    string
	DescriptionDoc []byte
	Priority       string
	AssigneeID     *string
	ReporterID     string
	Labels         []string
	ParentID       *string
	SprintID       *string
	StoryPoints    *float64
}

// CreateIssue allocates the next issue number, ranks the issue last, sets the
// workflow's initial status, and records the "created" event — one transaction.
func (s *Store) CreateIssue(ctx context.Context, n NewIssue) (Issue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Issue{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	projectID := n.ProjectID
	var number int64
	var workflowID string
	if err := tx.QueryRow(ctx,
		`UPDATE projects SET issue_seq = issue_seq + 1 WHERE id = $1 RETURNING issue_seq, workflow_id`,
		projectID).Scan(&number, &workflowID); err != nil {
		return Issue{}, fmt.Errorf("allocate issue number: %w", err)
	}

	var statusID string
	if err := tx.QueryRow(ctx,
		`SELECT id FROM statuses WHERE workflow_id = $1 ORDER BY position LIMIT 1`, workflowID).Scan(&statusID); err != nil {
		return Issue{}, fmt.Errorf("initial status: %w", err)
	}

	var lastRank *string
	if err := tx.QueryRow(ctx,
		`SELECT max(rank) FROM issues WHERE project_id = $1`, projectID).Scan(&lastRank); err != nil {
		return Issue{}, fmt.Errorf("last rank: %w", err)
	}
	prev := ""
	if lastRank != nil {
		prev = *lastRank
	}
	newRank, err := rank.After(prev)
	if err != nil {
		return Issue{}, fmt.Errorf("rank: %w", err)
	}

	var issueID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO issues (project_id, number, type, summary, description, description_doc, status_id, priority, assignee_id, reporter_id, rank, parent_id, sprint_id, story_points)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
		projectID, number, n.Type, n.Summary, n.Description, nullableJSON(n.DescriptionDoc), statusID, n.Priority, n.AssigneeID,
		n.ReporterID, newRank, n.ParentID, n.SprintID, n.StoryPoints).Scan(&issueID); err != nil {
		return Issue{}, fmt.Errorf("insert issue: %w", err)
	}

	if err := setLabelsTx(ctx, tx, projectID, issueID, n.Labels); err != nil {
		return Issue{}, err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO issue_events (issue_id, actor_id, field, new_value) VALUES ($1, $2, 'created', $3)`,
		issueID, n.ReporterID, jsonVal(n.Summary)); err != nil {
		return Issue{}, fmt.Errorf("record event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Issue{}, fmt.Errorf("commit: %w", err)
	}
	return s.GetIssueByID(ctx, issueID)
}

func (s *Store) GetIssueByID(ctx context.Context, id string) (Issue, error) {
	return scanIssue(s.pool.QueryRow(ctx, issueSelect+` WHERE i.id = $1`, id))
}

func (s *Store) GetIssueByKey(ctx context.Context, projectKey string, number int64) (Issue, error) {
	return scanIssue(s.pool.QueryRow(ctx, issueSelect+` WHERE p.key = $1 AND i.number = $2`, projectKey, number))
}

type IssueFilter struct {
	Query      string
	StatusID   string
	Type       string
	AssigneeID string
	SprintID   string
	ParentID   string
	Backlog    bool // unresolved issues not assigned to any sprint
	// Hide issues resolved longer ago than this (Jira's kanban Done column
	// shows the last two weeks); 0 = show everything.
	MaxResolvedAgeDays int
	StartAt            int
	MaxResults         int
}

// HiddenDoneCount counts a project's issues resolved longer ago than the
// board's Done-column window — powering "See older work items".
func (s *Store) HiddenDoneCount(ctx context.Context, projectID string, days int) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM issues i JOIN statuses s ON s.id = i.status_id
		WHERE i.project_id = $1 AND s.category = 'done'
		  AND COALESCE(i.resolved_at, i.updated_at) <= now() - $2 * interval '1 day'`, projectID, days).Scan(&n)
	return n, err
}

// ListIssues returns a page of a project's issues (rank order) plus the total count.
func (s *Store) ListIssues(ctx context.Context, projectID string, f IssueFilter) ([]Issue, int, error) {
	where := ` WHERE i.project_id = $1`
	args := []any{projectID}
	next := 2
	if f.StatusID != "" {
		where += fmt.Sprintf(" AND i.status_id = $%d", next)
		args = append(args, f.StatusID)
		next++
	}
	if f.Type != "" {
		where += fmt.Sprintf(" AND i.type = $%d", next)
		args = append(args, f.Type)
		next++
	}
	if f.AssigneeID != "" {
		where += fmt.Sprintf(" AND i.assignee_id = $%d", next)
		args = append(args, f.AssigneeID)
		next++
	}
	if f.SprintID != "" {
		where += fmt.Sprintf(" AND i.sprint_id = $%d", next)
		args = append(args, f.SprintID)
		next++
	}
	if f.ParentID != "" {
		where += fmt.Sprintf(" AND i.parent_id = $%d", next)
		args = append(args, f.ParentID)
		next++
	}
	if f.Backlog {
		where += " AND i.sprint_id IS NULL AND i.resolution IS NULL AND i.type <> 'epic' AND i.type <> 'subtask'"
	}
	if f.MaxResolvedAgeDays > 0 {
		// Imported history often lacks resolved_at — fall back to the last
		// update so ancient done items still age off the board.
		where += fmt.Sprintf(" AND NOT (s.category = 'done' AND COALESCE(i.resolved_at, i.updated_at) <= now() - $%d * interval '1 day')", next)
		args = append(args, f.MaxResolvedAgeDays)
		next++
	}
	if f.Query != "" {
		where += fmt.Sprintf(" AND (i.summary ILIKE '%%' || $%d || '%%'"+
			" OR (p.key || '-' || i.number) ILIKE upper($%d) || '%%'"+
			" OR ($%d ~ '^[0-9]+$' AND i.number::text = $%d))", next, next, next, next)
		args = append(args, f.Query)
		next++
	}

	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM issues i JOIN projects p ON p.id = i.project_id JOIN statuses s ON s.id = i.status_id`+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count issues: %w", err)
	}

	args = append(args, f.MaxResults, f.StartAt)
	rows, err := s.pool.Query(ctx,
		issueSelect+where+fmt.Sprintf(" ORDER BY i.rank LIMIT $%d OFFSET $%d", next, next+1), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list issues: %w", err)
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

// IssueUpdate carries partial edits; nil pointers mean "unchanged".
type IssueUpdate struct {
	Summary        *string
	Description    *string
	DescriptionDoc []byte // set together with Description
	Priority       *string
	Type           *string
	StartDate      *time.Time
	ClearStart     bool
	DueDate        *time.Time
	ClearDue       bool
	AssigneeID     *string // used when SetAssignee
	SetAssignee    bool    // true = assign to AssigneeID (nil = unassign)
	SprintID       *string // used when SetSprint
	SetSprint      bool    // true = move to SprintID (nil = backlog)
	ParentID       *string // used when SetParent
	SetParent      bool    // true = set parent to ParentID (nil = remove)
	Points         *float64
	SetPoints      bool
	Labels         *[]string
}

// UpdateIssue applies partial edits and records one changelog event per changed field.
func (s *Store) UpdateIssue(ctx context.Context, issueID, actorID string, upd IssueUpdate) (Issue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Issue{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	cur, err := scanIssue(tx.QueryRow(ctx, issueSelect+` WHERE i.id = $1 FOR UPDATE OF i`, issueID))
	if err != nil {
		return Issue{}, err
	}

	set := "updated_at = now()"
	args := []any{issueID}
	next := 2
	addSet := func(col string, v any) {
		set += fmt.Sprintf(", %s = $%d", col, next)
		args = append(args, v)
		next++
	}
	type change struct {
		field    string
		old, new any
	}
	changes := []change{}

	if upd.Summary != nil && *upd.Summary != cur.Summary {
		addSet("summary", *upd.Summary)
		changes = append(changes, change{"summary", cur.Summary, *upd.Summary})
	}
	// Formatting-only edits change the doc but not the plain mirror.
	if upd.Description != nil && (*upd.Description != cur.Description || upd.DescriptionDoc != nil) {
		addSet("description", *upd.Description)
		addSet("description_doc", nullableJSON(upd.DescriptionDoc))
		if *upd.Description != cur.Description {
			changes = append(changes, change{"description", cur.Description, *upd.Description})
		}
	}
	if upd.Priority != nil && *upd.Priority != cur.Priority {
		addSet("priority", *upd.Priority)
		changes = append(changes, change{"priority", cur.Priority, *upd.Priority})
	}
	if upd.Type != nil && *upd.Type != cur.Type {
		addSet("type", *upd.Type)
		changes = append(changes, change{"issuetype", cur.Type, *upd.Type})
	}
	if upd.StartDate != nil {
		addSet("start_date", *upd.StartDate)
		changes = append(changes, change{"startDate", cur.StartDate, *upd.StartDate})
	} else if upd.ClearStart && cur.StartDate != nil {
		addSet("start_date", nil)
		changes = append(changes, change{"startDate", cur.StartDate, nil})
	}
	if upd.DueDate != nil {
		addSet("due_date", *upd.DueDate)
		changes = append(changes, change{"duedate", cur.DueDate, *upd.DueDate})
	} else if upd.ClearDue && cur.DueDate != nil {
		addSet("due_date", nil)
		changes = append(changes, change{"duedate", cur.DueDate, nil})
	}
	if upd.SetSprint {
		oldName, newName := any(nil), any(nil)
		oldID := ""
		if cur.Sprint != nil {
			oldName, oldID = cur.Sprint.Name, cur.Sprint.ID
		}
		newID := ""
		if upd.SprintID != nil {
			newID = *upd.SprintID
			var name string
			if err := tx.QueryRow(ctx, `
				SELECT s.name FROM sprints s
				JOIN boards b ON b.id = s.board_id
				WHERE s.id = $1 AND b.project_id = $2 AND s.state <> 'closed'`,
				newID, cur.ProjectID).Scan(&name); err != nil {
				return Issue{}, fmt.Errorf("sprint lookup: %w", err)
			}
			newName = name
		}
		if oldID != newID {
			addSet("sprint_id", upd.SprintID)
			changes = append(changes, change{"sprint", oldName, newName})
		}
	}
	if upd.SetParent {
		oldKey, newKey := any(nil), any(nil)
		oldID := ""
		if cur.Parent != nil {
			oldKey, oldID = cur.Parent.Key, cur.Parent.ID
		}
		newID := ""
		if upd.ParentID != nil {
			newID = *upd.ParentID
			if newID == cur.ID {
				return Issue{}, fmt.Errorf("issue cannot be its own parent")
			}
			var key string
			if err := tx.QueryRow(ctx, `
				SELECT p.key || '-' || i.number FROM issues i
				JOIN projects p ON p.id = i.project_id
				WHERE i.id = $1 AND i.project_id = $2 AND i.type <> 'subtask'`,
				newID, cur.ProjectID).Scan(&key); err != nil {
				return Issue{}, fmt.Errorf("parent lookup: %w", err)
			}
			newKey = key
		}
		if oldID != newID {
			addSet("parent_id", upd.ParentID)
			changes = append(changes, change{"parent", oldKey, newKey})
		}
	}
	if upd.SetPoints {
		oldPts, newPts := any(nil), any(nil)
		same := cur.StoryPoints == nil && upd.Points == nil
		if cur.StoryPoints != nil {
			oldPts = *cur.StoryPoints
			same = upd.Points != nil && *upd.Points == *cur.StoryPoints
		}
		if upd.Points != nil {
			newPts = *upd.Points
		}
		if !same {
			addSet("story_points", upd.Points)
			changes = append(changes, change{"story points", oldPts, newPts})
		}
	}
	if upd.SetAssignee {
		oldName, newName := any(nil), any(nil)
		oldID := ""
		if cur.Assignee != nil {
			oldName, oldID = cur.Assignee.DisplayName, cur.Assignee.ID
		}
		newID := ""
		if upd.AssigneeID != nil {
			newID = *upd.AssigneeID
			var name string
			if err := tx.QueryRow(ctx, `SELECT display_name FROM users WHERE id = $1 AND is_active`, newID).Scan(&name); err != nil {
				return Issue{}, fmt.Errorf("assignee lookup: %w", err)
			}
			newName = name
		}
		if oldID != newID {
			addSet("assignee_id", upd.AssigneeID)
			changes = append(changes, change{"assignee", oldName, newName})
		}
	}

	if len(changes) > 0 || upd.Labels != nil {
		if _, err := tx.Exec(ctx, `UPDATE issues SET `+set+` WHERE id = $1`, args...); err != nil {
			return Issue{}, fmt.Errorf("update issue: %w", err)
		}
		if upd.Labels != nil {
			if _, err := tx.Exec(ctx, `DELETE FROM issue_labels WHERE issue_id = $1`, issueID); err != nil {
				return Issue{}, fmt.Errorf("clear labels: %w", err)
			}
			if err := setLabelsTx(ctx, tx, cur.ProjectID, issueID, *upd.Labels); err != nil {
				return Issue{}, err
			}
			changes = append(changes, change{"labels", cur.Labels, *upd.Labels})
		}
		for _, c := range changes {
			if _, err := tx.Exec(ctx,
				`INSERT INTO issue_events (issue_id, actor_id, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5)`,
				issueID, actorID, c.field, jsonVal(c.old), jsonVal(c.new)); err != nil {
				return Issue{}, fmt.Errorf("record event: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Issue{}, fmt.Errorf("commit: %w", err)
	}
	return s.GetIssueByID(ctx, issueID)
}

// TransitionIssue moves the issue to a status in its project's workflow,
// maintaining resolution the way Jira does (done category sets it, leaving clears it).
// TransitionIssue moves an issue along its workflow. ref is either a
// transition row id (issue-view menu) or a bare target status id (board
// drags) — both are validated against the workflow's transitions.
func (s *Store) TransitionIssue(ctx context.Context, issueID, ref, actorID string) (Issue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Issue{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	cur, err := scanIssue(tx.QueryRow(ctx, issueSelect+` WHERE i.id = $1 FOR UPDATE OF i`, issueID))
	if err != nil {
		return Issue{}, err
	}
	if ref == cur.Status.ID {
		tx.Rollback(ctx)
		return cur, nil
	}

	statusID, transitionID, err := resolveTransitionTargetTx(ctx, tx, cur.WorkflowID, cur.Status.ID, ref)
	if err != nil {
		return Issue{}, err
	}
	if statusID == cur.Status.ID {
		tx.Rollback(ctx)
		return cur, nil
	}

	// Stage 26: the workflow editor attaches rules to transitions.
	autoAssign, err := applyTransitionRulesTx(ctx, tx, &cur, transitionID, actorID)
	if err != nil {
		return Issue{}, err
	}

	var newStatus Status
	err = tx.QueryRow(ctx,
		`SELECT id, name, category, position FROM statuses WHERE workflow_id = $1 AND id = $2`,
		cur.WorkflowID, statusID).Scan(&newStatus.ID, &newStatus.Name, &newStatus.Category, &newStatus.Position)
	if errors.Is(err, pgx.ErrNoRows) {
		return Issue{}, ErrNotFound
	}
	if err != nil {
		return Issue{}, fmt.Errorf("status lookup: %w", err)
	}

	if newStatus.Category == "done" {
		_, err = tx.Exec(ctx,
			`UPDATE issues SET status_id = $2, resolution = 'done', resolved_at = now(), updated_at = now() WHERE id = $1`,
			issueID, statusID)
	} else {
		_, err = tx.Exec(ctx,
			`UPDATE issues SET status_id = $2, resolution = NULL, resolved_at = NULL, updated_at = now() WHERE id = $1`,
			issueID, statusID)
	}
	if err != nil {
		return Issue{}, fmt.Errorf("transition: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO issue_events (issue_id, actor_id, field, old_value, new_value) VALUES ($1, $2, 'status', $3, $4)`,
		issueID, actorID, jsonVal(cur.Status.Name), jsonVal(newStatus.Name)); err != nil {
		return Issue{}, fmt.Errorf("record event: %w", err)
	}

	// auto-assign post function, applied after the move like Jira's.
	if autoAssign != nil {
		var newAssigneeID *string
		newName := "Unassigned"
		switch *autoAssign {
		case "":
		case "actor":
			newAssigneeID = &actorID
		default:
			id := *autoAssign
			newAssigneeID = &id
		}
		if newAssigneeID != nil {
			if err := tx.QueryRow(ctx, `SELECT display_name FROM users WHERE id = $1`,
				*newAssigneeID).Scan(&newName); err != nil {
				return Issue{}, fmt.Errorf("auto-assign lookup: %w", err)
			}
		}
		oldName := "Unassigned"
		if cur.Assignee != nil {
			oldName = cur.Assignee.DisplayName
		}
		if oldName != newName {
			if _, err := tx.Exec(ctx,
				`UPDATE issues SET assignee_id = $2 WHERE id = $1`, issueID, newAssigneeID); err != nil {
				return Issue{}, fmt.Errorf("auto-assign: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO issue_events (issue_id, actor_id, field, old_value, new_value) VALUES ($1, $2, 'assignee', $3, $4)`,
				issueID, actorID, jsonVal(oldName), jsonVal(newName)); err != nil {
				return Issue{}, fmt.Errorf("record auto-assign: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Issue{}, fmt.Errorf("commit: %w", err)
	}
	return s.GetIssueByID(ctx, issueID)
}

// DeleteIssue removes the issue, returning its attachments' storage keys so
// the caller can clean object storage too.
func (s *Store) DeleteIssue(ctx context.Context, issueID string) ([]string, error) {
	blobKeys, err := s.attachmentStorageKeys(ctx, `WHERE a.issue_id = $1`, issueID)
	if err != nil {
		return nil, err
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM issues WHERE id = $1`, issueID)
	if err != nil {
		return nil, fmt.Errorf("delete issue: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return blobKeys, nil
}

func (s *Store) attachmentStorageKeys(ctx context.Context, where string, arg any) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT a.storage_key FROM attachments a `+where, arg)
	if err != nil {
		return nil, fmt.Errorf("attachment storage keys: %w", err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (s *Store) ListIssueEvents(ctx context.Context, issueID string) ([]IssueEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.field, e.old_value, e.new_value, e.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM issue_events e JOIN users u ON u.id = e.actor_id
		WHERE e.issue_id = $1 ORDER BY e.created_at DESC`, issueID)
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()
	events := []IssueEvent{}
	for rows.Next() {
		var e IssueEvent
		if err := rows.Scan(&e.ID, &e.Field, &e.OldValue, &e.NewValue, &e.CreatedAt,
			&e.Actor.ID, &e.Actor.Email, &e.Actor.DisplayName, &e.Actor.AvatarURL,
			&e.Actor.IsActive, &e.Actor.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// ListProjectLabels returns the distinct label names used in a project.
func (s *Store) ListProjectLabels(ctx context.Context, projectID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT name FROM labels WHERE project_id = $1 ORDER BY name`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list labels: %w", err)
	}
	defer rows.Close()
	labels := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		labels = append(labels, name)
	}
	return labels, rows.Err()
}

func setLabelsTx(ctx context.Context, tx pgx.Tx, projectID, issueID string, labels []string) error {
	for _, name := range labels {
		var labelID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO labels (project_id, name) VALUES ($1, $2)
			ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id`, projectID, name).Scan(&labelID); err != nil {
			return fmt.Errorf("upsert label: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2)
			ON CONFLICT DO NOTHING`, issueID, labelID); err != nil {
			return fmt.Errorf("link label: %w", err)
		}
	}
	return nil
}
