package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

var (
	ErrStatusInUse    = errors.New("status has work items assigned to it")
	ErrLastStatus     = errors.New("a workflow needs at least one status")
	ErrLeadRemoval    = errors.New("the space lead cannot be removed")
	ErrLabelNotFound  = errors.New("label not found")
	ErrLabelExists    = errors.New("a label with that name already exists")
	ErrMemberNotFound = errors.New("member not found")
)

// cloneWorkflowTx copies a workflow's statuses and creation transitions into a
// new workflow and returns its id. Used at project creation (and by migration
// 0010 for existing projects) so every space owns its own workflow.
func cloneWorkflowTx(ctx context.Context, tx pgx.Tx, fromID, name string) (string, error) {
	var newID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO workflows (name) VALUES ($1) RETURNING id`, name).Scan(&newID); err != nil {
		return "", fmt.Errorf("clone workflow: %w", err)
	}
	rows, err := tx.Query(ctx,
		`SELECT name, category, position FROM statuses WHERE workflow_id = $1 ORDER BY position`, fromID)
	if err != nil {
		return "", fmt.Errorf("clone statuses: %w", err)
	}
	type st struct {
		name, category string
		pos            int
	}
	var statuses []st
	for rows.Next() {
		var s st
		if err := rows.Scan(&s.name, &s.category, &s.pos); err != nil {
			rows.Close()
			return "", err
		}
		statuses = append(statuses, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}
	for _, s := range statuses {
		var stID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO statuses (workflow_id, name, category, position) VALUES ($1, $2, $3, $4) RETURNING id`,
			newID, s.name, s.category, s.pos).Scan(&stID); err != nil {
			return "", fmt.Errorf("clone status: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO transitions (workflow_id, from_status_id, to_status_id, name) VALUES ($1, NULL, $2, $3)`,
			newID, stID, s.name); err != nil {
			return "", fmt.Errorf("clone transition: %w", err)
		}
	}
	return newID, nil
}

// ---- details ----

type ProjectDetailsUpdate struct {
	Name              string  `json:"name"`
	Description       string  `json:"description"`
	LeadID            *string `json:"leadId"`
	DefaultAssigneeID *string `json:"defaultAssigneeId"`
	URL               *string `json:"url"`        // nil = keep
	CategoryID        *string `json:"categoryId"` // nil = keep, "" = clear
}

func (s *Store) UpdateProjectDetails(ctx context.Context, key string, u ProjectDetailsUpdate) (Project, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Project{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE projects SET name = $2, description = $3,
			lead_id = COALESCE($4, lead_id), default_assignee_id = $5,
			url = COALESCE($6, url),
			category_id = CASE WHEN $7::text IS NULL THEN category_id
			                   WHEN $7 = '' THEN NULL
			                   ELSE $7::uuid END,
			updated_at = now()
		WHERE key = $1`,
		key, u.Name, u.Description, u.LeadID, u.DefaultAssigneeID, u.URL, u.CategoryID)
	if err != nil {
		return Project{}, fmt.Errorf("update details: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Project{}, ErrNotFound
	}
	// A new lead must be a member; promote them to space admin.
	if u.LeadID != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_members (project_id, user_id, role)
			SELECT id, $2, 'admin' FROM projects WHERE key = $1
			ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'admin'`, key, *u.LeadID); err != nil {
			return Project{}, fmt.Errorf("promote lead: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Project{}, fmt.Errorf("commit: %w", err)
	}
	return s.GetProjectByKey(ctx, key)
}

// SetProjectImage stores the space avatar blob key, returning the old key for cleanup.
func (s *Store) SetProjectImage(ctx context.Context, projectID string, key *string) (oldKey *string, err error) {
	err = s.pool.QueryRow(ctx, `
		UPDATE projects SET avatar_key = $2, updated_at = now() WHERE id = $1
		RETURNING (SELECT avatar_key FROM projects WHERE id = $1)`, projectID, key).Scan(&oldKey)
	if err != nil {
		return nil, fmt.Errorf("set project avatar: %w", err)
	}
	return oldKey, nil
}

// ---- access ----

func (s *Store) UpdateMemberRole(ctx context.Context, projectID, userID, role string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2`,
		projectID, userID, role)
	if err != nil {
		return fmt.Errorf("update member role: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrMemberNotFound
	}
	return nil
}

func (s *Store) RemoveMember(ctx context.Context, projectID, userID string) error {
	var isLead bool
	if err := s.pool.QueryRow(ctx,
		`SELECT lead_id = $2 FROM projects WHERE id = $1`, projectID, userID).Scan(&isLead); err != nil {
		return fmt.Errorf("check lead: %w", err)
	}
	if isLead {
		return ErrLeadRemoval
	}
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, projectID, userID)
	if err != nil {
		return fmt.Errorf("remove member: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrMemberNotFound
	}
	return nil
}

// ---- labels ----

type LabelInfo struct {
	Name       string `json:"name"`
	IssueCount int    `json:"issueCount"`
}

func (s *Store) ListLabelInfo(ctx context.Context, projectID string) ([]LabelInfo, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.name, count(il.issue_id)
		FROM labels l LEFT JOIN issue_labels il ON il.label_id = l.id
		WHERE l.project_id = $1
		GROUP BY l.id ORDER BY l.name`, projectID)
	if err != nil {
		return nil, fmt.Errorf("label info: %w", err)
	}
	defer rows.Close()
	labels := []LabelInfo{}
	for rows.Next() {
		var l LabelInfo
		if err := rows.Scan(&l.Name, &l.IssueCount); err != nil {
			return nil, err
		}
		labels = append(labels, l)
	}
	return labels, rows.Err()
}

// RenameLabel renames a label; if the new name already exists it merges the
// two (issues move to the surviving label).
func (s *Store) RenameLabel(ctx context.Context, projectID, oldName, newName string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var oldID string
	err = tx.QueryRow(ctx,
		`SELECT id FROM labels WHERE project_id = $1 AND name = $2`, projectID, oldName).Scan(&oldID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLabelNotFound
	}
	if err != nil {
		return fmt.Errorf("find label: %w", err)
	}

	var newID string
	err = tx.QueryRow(ctx,
		`SELECT id FROM labels WHERE project_id = $1 AND name = $2`, projectID, newName).Scan(&newID)
	switch {
	case errors.Is(err, pgx.ErrNoRows): // plain rename
		if _, err := tx.Exec(ctx, `UPDATE labels SET name = $2 WHERE id = $1`, oldID, newName); err != nil {
			return fmt.Errorf("rename label: %w", err)
		}
	case err != nil:
		return fmt.Errorf("find target label: %w", err)
	default: // merge into existing
		if _, err := tx.Exec(ctx, `
			INSERT INTO issue_labels (issue_id, label_id)
			SELECT issue_id, $2 FROM issue_labels WHERE label_id = $1
			ON CONFLICT DO NOTHING`, oldID, newID); err != nil {
			return fmt.Errorf("merge labels: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM labels WHERE id = $1`, oldID); err != nil {
			return fmt.Errorf("drop merged label: %w", err)
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteLabel(ctx context.Context, projectID, name string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM labels WHERE project_id = $1 AND name = $2`, projectID, name)
	if err != nil {
		return fmt.Errorf("delete label: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrLabelNotFound
	}
	return nil
}

// ---- statuses (per-project workflow since migration 0010) ----

// AddStatus appends a status to the project's workflow and a matching board
// column mapped to it on every board of the project.
func (s *Store) AddStatus(ctx context.Context, projectID, workflowID, name, category string) (Status, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Status{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var st Status
	err = tx.QueryRow(ctx, `
		INSERT INTO statuses (workflow_id, name, category, position)
		VALUES ($1, $2, $3, (SELECT COALESCE(max(position), 0) + 1 FROM statuses WHERE workflow_id = $1))
		RETURNING id, name, category, position`, workflowID, name, category).
		Scan(&st.ID, &st.Name, &st.Category, &st.Position)
	if err != nil {
		return Status{}, fmt.Errorf("insert status: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO transitions (workflow_id, from_status_id, to_status_id, name) VALUES ($1, NULL, $2, $3)`,
		workflowID, st.ID, st.Name); err != nil {
		return Status{}, fmt.Errorf("insert transition: %w", err)
	}

	boards, err := tx.Query(ctx, `SELECT id FROM boards WHERE project_id = $1`, projectID)
	if err != nil {
		return Status{}, fmt.Errorf("boards: %w", err)
	}
	var boardIDs []string
	for boards.Next() {
		var id string
		if err := boards.Scan(&id); err != nil {
			boards.Close()
			return Status{}, err
		}
		boardIDs = append(boardIDs, id)
	}
	boards.Close()
	if err := boards.Err(); err != nil {
		return Status{}, err
	}
	for _, boardID := range boardIDs {
		var colID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO board_columns (board_id, name, position)
			VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM board_columns WHERE board_id = $1))
			RETURNING id`, boardID, st.Name).Scan(&colID); err != nil {
			return Status{}, fmt.Errorf("insert column: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO board_column_statuses (column_id, status_id) VALUES ($1, $2)`, colID, st.ID); err != nil {
			return Status{}, fmt.Errorf("map column: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE workflows SET updated_at = now() WHERE id = $1`, workflowID); err != nil {
		return Status{}, fmt.Errorf("touch workflow: %w", err)
	}
	return st, tx.Commit(ctx)
}

func (s *Store) RenameStatus(ctx context.Context, workflowID, statusID, name string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE statuses SET name = $3 WHERE workflow_id = $1 AND id = $2`, workflowID, statusID, name)
	if err != nil {
		return fmt.Errorf("rename status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_, _ = s.pool.Exec(ctx, `UPDATE workflows SET updated_at = now() WHERE id = $1`, workflowID)
	return nil
}

// DeleteStatus removes an unused status, its transitions, its column mappings,
// and any board column left with no mapped statuses.
func (s *Store) DeleteStatus(ctx context.Context, projectID, workflowID, statusID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM statuses WHERE workflow_id = $1 AND id = $2)`,
		workflowID, statusID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	var count int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM statuses WHERE workflow_id = $1`, workflowID).Scan(&count); err != nil {
		return err
	}
	if count <= 1 {
		return ErrLastStatus
	}
	var used bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM issues WHERE project_id = $1 AND status_id = $2)`,
		projectID, statusID).Scan(&used); err != nil {
		return err
	}
	if used {
		return ErrStatusInUse
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM transitions WHERE workflow_id = $1 AND (from_status_id = $2 OR to_status_id = $2)`,
		workflowID, statusID); err != nil {
		return fmt.Errorf("delete transitions: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM board_column_statuses WHERE status_id = $1`, statusID); err != nil {
		return fmt.Errorf("unmap columns: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM board_columns c
		USING boards b
		WHERE c.board_id = b.id AND b.project_id = $1
		  AND NOT EXISTS (SELECT 1 FROM board_column_statuses cs WHERE cs.column_id = c.id)`,
		projectID); err != nil {
		return fmt.Errorf("drop empty columns: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM statuses WHERE id = $1`, statusID); err != nil {
		return fmt.Errorf("delete status: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE workflows SET updated_at = now() WHERE id = $1`, workflowID); err != nil {
		return fmt.Errorf("touch workflow: %w", err)
	}
	return tx.Commit(ctx)
}

// ReorderColumns updates column positions on a board.
func (s *Store) ReorderColumns(ctx context.Context, boardID string, orderedIDs []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	// Two passes to dodge any (board_id, position) uniqueness during the swap.
	for i, id := range orderedIDs {
		tag, err := tx.Exec(ctx,
			`UPDATE board_columns SET position = $3 WHERE id = $1 AND board_id = $2`, id, boardID, 1000+i)
		if err != nil {
			return fmt.Errorf("stage position: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	for i, id := range orderedIDs {
		if _, err := tx.Exec(ctx,
			`UPDATE board_columns SET position = $3 WHERE id = $1 AND board_id = $2`, id, boardID, i); err != nil {
			return fmt.Errorf("set position: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// ---- archive & notifications ----

func (s *Store) SetProjectArchived(ctx context.Context, key string, archived bool) (Project, error) {
	set := `archived_at = now()`
	if !archived {
		set = `archived_at = NULL`
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE projects SET `+set+`, updated_at = now() WHERE key = $1`, key)
	if err != nil {
		return Project{}, fmt.Errorf("set archived: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Project{}, ErrNotFound
	}
	return s.GetProjectByKey(ctx, key)
}

func (s *Store) UpdateNotifyPrefs(ctx context.Context, key string, prefs map[string]bool) (Project, error) {
	raw, err := json.Marshal(prefs)
	if err != nil {
		return Project{}, err
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE projects SET notify_prefs = $2, updated_at = now() WHERE key = $1`, key, raw)
	if err != nil {
		return Project{}, fmt.Errorf("update notify prefs: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Project{}, ErrNotFound
	}
	return s.GetProjectByKey(ctx, key)
}

// NotifyPrefsByProjectKey is used by the worker to gate outgoing email.
// Missing keys default to true.
func (s *Store) NotifyPrefsByProjectKey(ctx context.Context, key string) (map[string]bool, error) {
	var prefs map[string]bool
	err := s.pool.QueryRow(ctx,
		`SELECT notify_prefs FROM projects WHERE key = $1`, key).Scan(&prefs)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]bool{}, nil
	}
	if prefs == nil {
		prefs = map[string]bool{}
	}
	return prefs, err
}
