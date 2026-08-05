package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Status struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"` // todo | in_progress | done
	Position int    `json:"position"`
}

func (s *Store) ListStatuses(ctx context.Context, workflowID string) ([]Status, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, category, position FROM statuses WHERE workflow_id = $1 ORDER BY position`, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list statuses: %w", err)
	}
	defer rows.Close()
	statuses := []Status{}
	for rows.Next() {
		var st Status
		if err := rows.Scan(&st.ID, &st.Name, &st.Category, &st.Position); err != nil {
			return nil, err
		}
		statuses = append(statuses, st)
	}
	return statuses, rows.Err()
}

func (s *Store) GetStatus(ctx context.Context, workflowID, statusID string) (Status, error) {
	var st Status
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, category, position FROM statuses WHERE workflow_id = $1 AND id = $2`,
		workflowID, statusID).Scan(&st.ID, &st.Name, &st.Category, &st.Position)
	if errors.Is(err, pgx.ErrNoRows) {
		return Status{}, ErrNotFound
	}
	return st, err
}

// FirstStatus returns the workflow's initial status (lowest position).
func (s *Store) FirstStatus(ctx context.Context, workflowID string) (Status, error) {
	var st Status
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, category, position FROM statuses WHERE workflow_id = $1 ORDER BY position LIMIT 1`,
		workflowID).Scan(&st.ID, &st.Name, &st.Category, &st.Position)
	if errors.Is(err, pgx.ErrNoRows) {
		return Status{}, ErrNotFound
	}
	return st, err
}

// ---- Stage 26: workflow editor ----

var ErrWorkflowInvalid = errors.New("workflow invalid")

// workflowError wraps a user-facing validation message from the bulk editor.
func workflowError(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrWorkflowInvalid}, args...)...)
}

var ruleKinds = map[string]bool{"restrict-who": true, "required-field": true, "auto-assign": true}

type WorkflowStatus struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Category string   `json:"category"`
	Position int      `json:"position"`
	X        *float64 `json:"x"`
	Y        *float64 `json:"y"`
}

type TransitionRule struct {
	ID     string          `json:"id"`
	Kind   string          `json:"kind"`
	Config json.RawMessage `json:"config"`
}

type WorkflowEdge struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	FromStatusID *string          `json:"fromStatusId"` // nil = from any status
	ToStatusID   string           `json:"toStatusId"`
	Rules        []TransitionRule `json:"rules"`
}

type WorkflowDetail struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Statuses    []WorkflowStatus `json:"statuses"`
	Transitions []WorkflowEdge   `json:"transitions"`
}

func (s *Store) GetWorkflowDetail(ctx context.Context, workflowID string) (WorkflowDetail, error) {
	d := WorkflowDetail{ID: workflowID, Statuses: []WorkflowStatus{}, Transitions: []WorkflowEdge{}}
	err := s.pool.QueryRow(ctx, `SELECT name FROM workflows WHERE id = $1`, workflowID).Scan(&d.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	if err != nil {
		return d, fmt.Errorf("workflow: %w", err)
	}

	rows, err := s.pool.Query(ctx,
		`SELECT id, name, category, position, pos_x, pos_y FROM statuses WHERE workflow_id = $1 ORDER BY position`,
		workflowID)
	if err != nil {
		return d, fmt.Errorf("workflow statuses: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var st WorkflowStatus
		if err := rows.Scan(&st.ID, &st.Name, &st.Category, &st.Position, &st.X, &st.Y); err != nil {
			return d, err
		}
		d.Statuses = append(d.Statuses, st)
	}
	if err := rows.Err(); err != nil {
		return d, err
	}

	trows, err := s.pool.Query(ctx, `
		SELECT t.id, t.name, t.from_status_id, t.to_status_id,
		       COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'config', r.config)
		                          ORDER BY r.created_at) FILTER (WHERE r.id IS NOT NULL), '[]')
		FROM transitions t
		LEFT JOIN transition_rules r ON r.transition_id = t.id
		WHERE t.workflow_id = $1
		GROUP BY t.id
		ORDER BY t.from_status_id NULLS FIRST, t.name`, workflowID)
	if err != nil {
		return d, fmt.Errorf("workflow transitions: %w", err)
	}
	defer trows.Close()
	for trows.Next() {
		var e WorkflowEdge
		var rules []byte
		if err := trows.Scan(&e.ID, &e.Name, &e.FromStatusID, &e.ToStatusID, &rules); err != nil {
			return d, err
		}
		if err := json.Unmarshal(rules, &e.Rules); err != nil {
			return d, fmt.Errorf("workflow rules: %w", err)
		}
		d.Transitions = append(d.Transitions, e)
	}
	return d, trows.Err()
}

// Bulk-save inputs. New statuses carry a client-side temp id ("tmp-…");
// transition refs point at either an existing status id or a temp id.
type WorkflowStatusInput struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Category string   `json:"category"`
	X        *float64 `json:"x"`
	Y        *float64 `json:"y"`
}

type WorkflowRuleInput struct {
	Kind   string          `json:"kind"`
	Config json.RawMessage `json:"config"`
}

type WorkflowTransitionInput struct {
	Name    string              `json:"name"`
	FromRef *string             `json:"fromRef"` // nil = any status
	ToRef   string              `json:"toRef"`
	Rules   []WorkflowRuleInput `json:"rules"`
}

type WorkflowUpdate struct {
	Statuses    []WorkflowStatusInput     `json:"statuses"`
	Transitions []WorkflowTransitionInput `json:"transitions"`
}

// UpdateWorkflow replaces the workflow's statuses, transitions and rules in
// one transaction — the editor's "Update workflow" commit. Board columns stay
// in sync: new statuses get a column on every board, deleted statuses drop
// their mappings (and any column left empty).
func (s *Store) UpdateWorkflow(ctx context.Context, projectID, workflowID string, upd WorkflowUpdate) (WorkflowDetail, error) {
	if err := validateWorkflowUpdate(upd); err != nil {
		return WorkflowDetail{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkflowDetail{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Existing statuses.
	existing := map[string]string{} // id -> name
	rows, err := tx.Query(ctx, `SELECT id, name FROM statuses WHERE workflow_id = $1`, workflowID)
	if err != nil {
		return WorkflowDetail{}, fmt.Errorf("statuses: %w", err)
	}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return WorkflowDetail{}, err
		}
		existing[id] = name
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return WorkflowDetail{}, err
	}

	kept := map[string]bool{}
	for _, st := range upd.Statuses {
		if _, ok := existing[st.ID]; ok {
			kept[st.ID] = true
		}
	}

	// Delete removed statuses (guarded: no work items may sit on them).
	// An unassigned workflow (projectID == "") has no issues or boards.
	for id, name := range existing {
		if kept[id] {
			continue
		}
		if projectID != "" {
			var used bool
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM issues WHERE project_id = $1 AND status_id = $2)`,
				projectID, id).Scan(&used); err != nil {
				return WorkflowDetail{}, err
			}
			if used {
				return WorkflowDetail{}, workflowError("status %q still has work items — move them first", name)
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM board_column_statuses WHERE status_id = $1`, id); err != nil {
			return WorkflowDetail{}, fmt.Errorf("unmap columns: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM transitions WHERE workflow_id = $1 AND (from_status_id = $2 OR to_status_id = $2)`,
			workflowID, id); err != nil {
			return WorkflowDetail{}, fmt.Errorf("status transitions: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM statuses WHERE id = $1`, id); err != nil {
			return WorkflowDetail{}, fmt.Errorf("delete status: %w", err)
		}
	}
	if projectID != "" {
		if _, err := tx.Exec(ctx, `
			DELETE FROM board_columns c
			USING boards b
			WHERE c.board_id = b.id AND b.project_id = $1
			  AND NOT EXISTS (SELECT 1 FROM board_column_statuses cs WHERE cs.column_id = c.id)`,
			projectID); err != nil {
			return WorkflowDetail{}, fmt.Errorf("drop empty columns: %w", err)
		}
	}

	// Upsert statuses in the submitted order; resolve refs for transitions.
	refToID := map[string]string{}
	for i, st := range upd.Statuses {
		if _, ok := existing[st.ID]; ok {
			if _, err := tx.Exec(ctx, `
				UPDATE statuses SET name = $3, category = $4, position = $5, pos_x = $6, pos_y = $7
				WHERE workflow_id = $1 AND id = $2`,
				workflowID, st.ID, st.Name, st.Category, i+1, st.X, st.Y); err != nil {
				return WorkflowDetail{}, fmt.Errorf("update status: %w", err)
			}
			refToID[st.ID] = st.ID
			continue
		}
		var newID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO statuses (workflow_id, name, category, position, pos_x, pos_y)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			workflowID, st.Name, st.Category, i+1, st.X, st.Y).Scan(&newID); err != nil {
			return WorkflowDetail{}, fmt.Errorf("insert status: %w", err)
		}
		refToID[st.ID] = newID
		if projectID == "" {
			continue
		}
		// A column on every board, like the classic status editor.
		boardRows, err := tx.Query(ctx, `SELECT id FROM boards WHERE project_id = $1`, projectID)
		if err != nil {
			return WorkflowDetail{}, fmt.Errorf("boards: %w", err)
		}
		var boardIDs []string
		for boardRows.Next() {
			var id string
			if err := boardRows.Scan(&id); err != nil {
				boardRows.Close()
				return WorkflowDetail{}, err
			}
			boardIDs = append(boardIDs, id)
		}
		boardRows.Close()
		if err := boardRows.Err(); err != nil {
			return WorkflowDetail{}, err
		}
		for _, boardID := range boardIDs {
			var colID string
			if err := tx.QueryRow(ctx, `
				INSERT INTO board_columns (board_id, name, position)
				VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM board_columns WHERE board_id = $1))
				RETURNING id`, boardID, st.Name).Scan(&colID); err != nil {
				return WorkflowDetail{}, fmt.Errorf("insert column: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO board_column_statuses (column_id, status_id) VALUES ($1, $2)`, colID, newID); err != nil {
				return WorkflowDetail{}, fmt.Errorf("map column: %w", err)
			}
		}
	}

	// Replace transitions wholesale (rules cascade with them).
	if _, err := tx.Exec(ctx, `DELETE FROM transitions WHERE workflow_id = $1`, workflowID); err != nil {
		return WorkflowDetail{}, fmt.Errorf("clear transitions: %w", err)
	}
	for _, tr := range upd.Transitions {
		toID, ok := refToID[tr.ToRef]
		if !ok {
			return WorkflowDetail{}, workflowError("transition %q points at an unknown status", tr.Name)
		}
		var fromID *string
		if tr.FromRef != nil {
			id, ok := refToID[*tr.FromRef]
			if !ok {
				return WorkflowDetail{}, workflowError("transition %q starts from an unknown status", tr.Name)
			}
			fromID = &id
		}
		var trID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO transitions (workflow_id, from_status_id, to_status_id, name)
			VALUES ($1, $2, $3, $4) RETURNING id`,
			workflowID, fromID, toID, tr.Name).Scan(&trID); err != nil {
			return WorkflowDetail{}, fmt.Errorf("insert transition: %w", err)
		}
		for _, rule := range tr.Rules {
			cfg := rule.Config
			if len(cfg) == 0 {
				cfg = json.RawMessage(`{}`)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO transition_rules (transition_id, kind, config) VALUES ($1, $2, $3)`,
				trID, rule.Kind, cfg); err != nil {
				return WorkflowDetail{}, fmt.Errorf("insert rule: %w", err)
			}
		}
	}

	if _, err := tx.Exec(ctx,
		`UPDATE workflows SET updated_at = now() WHERE id = $1`, workflowID); err != nil {
		return WorkflowDetail{}, fmt.Errorf("touch workflow: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return WorkflowDetail{}, fmt.Errorf("commit: %w", err)
	}
	return s.GetWorkflowDetail(ctx, workflowID)
}

// ---- Stage 26b: admin workflows directory (Settings → Work items → Workflows) ----

type WorkflowSpaceRef struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

type AdminWorkflowRow struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	IsDefault bool               `json:"isDefault"`
	UpdatedAt time.Time          `json:"updatedAt"`
	Spaces    []WorkflowSpaceRef `json:"spaces"`
}

// ListWorkflowsAdmin returns every workflow with the spaces using it —
// active (assigned) workflows first, like Jira's Workflows page.
func (s *Store) ListWorkflowsAdmin(ctx context.Context) ([]AdminWorkflowRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT w.id, w.name, w.is_default, w.updated_at,
		       COALESCE(jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name) ORDER BY p.key)
		                FILTER (WHERE p.id IS NOT NULL), '[]')
		FROM workflows w
		LEFT JOIN projects p ON p.workflow_id = w.id
		GROUP BY w.id
		ORDER BY (count(p.id) = 0), w.is_default DESC, lower(w.name)`)
	if err != nil {
		return nil, fmt.Errorf("list workflows: %w", err)
	}
	defer rows.Close()
	out := []AdminWorkflowRow{}
	for rows.Next() {
		var r AdminWorkflowRow
		var spaces []byte
		if err := rows.Scan(&r.ID, &r.Name, &r.IsDefault, &r.UpdatedAt, &spaces); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(spaces, &r.Spaces); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// WorkflowSpaces returns the spaces assigned to a workflow (the "used in" chip).
func (s *Store) WorkflowSpaces(ctx context.Context, workflowID string) ([]WorkflowSpaceRef, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT key, name FROM projects WHERE workflow_id = $1 ORDER BY key`, workflowID)
	if err != nil {
		return nil, fmt.Errorf("workflow spaces: %w", err)
	}
	defer rows.Close()
	out := []WorkflowSpaceRef{}
	for rows.Next() {
		var r WorkflowSpaceRef
		if err := rows.Scan(&r.Key, &r.Name); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ProjectIDByWorkflow resolves the (single, since migration 0010) space that
// owns a workflow; "" when the workflow is unassigned.
func (s *Store) ProjectIDByWorkflow(ctx context.Context, workflowID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM projects WHERE workflow_id = $1 LIMIT 1`, workflowID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// fullCloneWorkflowTx copies a workflow completely — statuses (with diagram
// positions), all transitions and their rules — unlike cloneWorkflowTx which
// only carries the creation transitions.
func fullCloneWorkflowTx(ctx context.Context, tx pgx.Tx, fromID, name string) (string, error) {
	var newID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO workflows (name) VALUES ($1) RETURNING id`, name).Scan(&newID); err != nil {
		return "", fmt.Errorf("copy workflow: %w", err)
	}
	idMap := map[string]string{}
	rows, err := tx.Query(ctx,
		`SELECT id, name, category, position, pos_x, pos_y FROM statuses WHERE workflow_id = $1 ORDER BY position`, fromID)
	if err != nil {
		return "", fmt.Errorf("copy statuses: %w", err)
	}
	var sts []WorkflowStatus
	for rows.Next() {
		var st WorkflowStatus
		if err := rows.Scan(&st.ID, &st.Name, &st.Category, &st.Position, &st.X, &st.Y); err != nil {
			rows.Close()
			return "", err
		}
		sts = append(sts, st)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}
	for _, st := range sts {
		var stID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO statuses (workflow_id, name, category, position, pos_x, pos_y)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			newID, st.Name, st.Category, st.Position, st.X, st.Y).Scan(&stID); err != nil {
			return "", fmt.Errorf("copy status: %w", err)
		}
		idMap[st.ID] = stID
	}
	trows, err := tx.Query(ctx,
		`SELECT id, name, from_status_id, to_status_id FROM transitions WHERE workflow_id = $1`, fromID)
	if err != nil {
		return "", fmt.Errorf("copy transitions: %w", err)
	}
	type tr struct {
		id, name, to string
		from         *string
	}
	var trs []tr
	for trows.Next() {
		var t tr
		if err := trows.Scan(&t.id, &t.name, &t.from, &t.to); err != nil {
			trows.Close()
			return "", err
		}
		trs = append(trs, t)
	}
	trows.Close()
	if err := trows.Err(); err != nil {
		return "", err
	}
	for _, t := range trs {
		var fromRef *string
		if t.from != nil {
			mapped := idMap[*t.from]
			fromRef = &mapped
		}
		var trID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO transitions (workflow_id, from_status_id, to_status_id, name)
			VALUES ($1, $2, $3, $4) RETURNING id`,
			newID, fromRef, idMap[t.to], t.name).Scan(&trID); err != nil {
			return "", fmt.Errorf("copy transition: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO transition_rules (transition_id, kind, config)
			SELECT $2, kind, config FROM transition_rules WHERE transition_id = $1`,
			t.id, trID); err != nil {
			return "", fmt.Errorf("copy rules: %w", err)
		}
	}
	return newID, nil
}

// CopyWorkflowAdmin duplicates a workflow as an unassigned one ("Copy of X").
func (s *Store) CopyWorkflowAdmin(ctx context.Context, workflowID string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var name string
	err = tx.QueryRow(ctx, `SELECT name FROM workflows WHERE id = $1`, workflowID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	newID, err := fullCloneWorkflowTx(ctx, tx, workflowID, "Copy of "+name)
	if err != nil {
		return "", err
	}
	return newID, tx.Commit(ctx)
}

// CreateWorkflowAdmin makes a new unassigned workflow seeded from the default.
func (s *Store) CreateWorkflowAdmin(ctx context.Context, name string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var defaultID string
	if err := tx.QueryRow(ctx,
		`SELECT id FROM workflows WHERE is_default LIMIT 1`).Scan(&defaultID); err != nil {
		return "", fmt.Errorf("default workflow: %w", err)
	}
	newID, err := fullCloneWorkflowTx(ctx, tx, defaultID, name)
	if err != nil {
		return "", err
	}
	return newID, tx.Commit(ctx)
}

var ErrWorkflowInUse = errors.New("workflow is used by a space")

// DeleteWorkflowAdmin removes an inactive (unassigned, non-default) workflow.
func (s *Store) DeleteWorkflowAdmin(ctx context.Context, workflowID string) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM workflows WHERE id = $1 AND is_default = FALSE
		  AND NOT EXISTS (SELECT 1 FROM projects WHERE workflow_id = $1)`, workflowID)
	if err != nil {
		return fmt.Errorf("delete workflow: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM workflows WHERE id = $1)`, workflowID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return ErrWorkflowInUse
	}
	return nil
}

func (s *Store) RenameWorkflow(ctx context.Context, workflowID, name string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE workflows SET name = $2, updated_at = now() WHERE id = $1`, workflowID, name)
	if err != nil {
		return fmt.Errorf("rename workflow: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AssignWorkflowToProject switches a space onto (a private clone of) the given
// workflow, Jira-scheme style: issues are remapped to the new statuses by
// name (falling back to the initial status), board columns are rebuilt, and
// the space's old orphaned workflow is dropped.
func (s *Store) AssignWorkflowToProject(ctx context.Context, projectID, sourceWorkflowID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var key, oldWfID string
	err = tx.QueryRow(ctx,
		`SELECT key, workflow_id FROM projects WHERE id = $1`, projectID).Scan(&key, &oldWfID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if oldWfID == sourceWorkflowID {
		return nil
	}

	newID, err := fullCloneWorkflowTx(ctx, tx, sourceWorkflowID, key+" workflow")
	if err != nil {
		return err
	}

	// Remap issues by status name; unmatched statuses land on the initial one.
	if _, err := tx.Exec(ctx, `
		UPDATE issues i SET status_id = COALESCE(
			(SELECT n.id FROM statuses n
			 WHERE n.workflow_id = $2
			   AND lower(n.name) = (SELECT lower(o.name) FROM statuses o WHERE o.id = i.status_id)),
			(SELECT id FROM statuses WHERE workflow_id = $2 ORDER BY position LIMIT 1))
		WHERE i.project_id = $1`, projectID, newID); err != nil {
		return fmt.Errorf("remap issues: %w", err)
	}
	// Resolution follows the landed status category, like a transition would.
	if _, err := tx.Exec(ctx, `
		UPDATE issues i SET
			resolution  = CASE WHEN s.category = 'done' THEN COALESCE(i.resolution, 'done') END,
			resolved_at = CASE WHEN s.category = 'done' THEN COALESCE(i.resolved_at, now()) END
		FROM statuses s
		WHERE s.id = i.status_id AND i.project_id = $1`, projectID); err != nil {
		return fmt.Errorf("remap resolutions: %w", err)
	}

	// Rebuild board columns 1:1 with the new statuses (mappings cascade).
	if _, err := tx.Exec(ctx, `
		DELETE FROM board_columns c USING boards b
		WHERE c.board_id = b.id AND b.project_id = $1`, projectID); err != nil {
		return fmt.Errorf("clear columns: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_columns (board_id, name, position)
		SELECT b.id, s.name, s.position FROM boards b
		CROSS JOIN statuses s
		WHERE b.project_id = $1 AND s.workflow_id = $2`, projectID, newID); err != nil {
		return fmt.Errorf("rebuild columns: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_column_statuses (column_id, status_id)
		SELECT c.id, s.id FROM board_columns c
		JOIN boards b ON b.id = c.board_id
		JOIN statuses s ON s.workflow_id = $2 AND s.name = c.name
		WHERE b.project_id = $1`, projectID, newID); err != nil {
		return fmt.Errorf("map columns: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE projects SET workflow_id = $2, updated_at = now() WHERE id = $1`, projectID, newID); err != nil {
		return fmt.Errorf("assign workflow: %w", err)
	}
	// The old per-space workflow is orphaned now; drop it unless it's the template.
	if _, err := tx.Exec(ctx, `
		DELETE FROM workflows WHERE id = $1 AND is_default = FALSE
		  AND NOT EXISTS (SELECT 1 FROM projects WHERE workflow_id = $1)`, oldWfID); err != nil {
		return fmt.Errorf("drop old workflow: %w", err)
	}
	return tx.Commit(ctx)
}

func validateWorkflowUpdate(upd WorkflowUpdate) error {
	if len(upd.Statuses) == 0 {
		return workflowError("a workflow needs at least one status")
	}
	names := map[string]bool{}
	ids := map[string]bool{}
	for _, st := range upd.Statuses {
		name := strings.TrimSpace(st.Name)
		if name == "" {
			return workflowError("every status needs a name")
		}
		if st.ID == "" {
			return workflowError("every status needs an id (existing or temporary)")
		}
		lower := strings.ToLower(name)
		if names[lower] {
			return workflowError("two statuses share the name %q", name)
		}
		if ids[st.ID] {
			return workflowError("duplicate status id %q", st.ID)
		}
		names[lower] = true
		ids[st.ID] = true
		if st.Category != "todo" && st.Category != "in_progress" && st.Category != "done" {
			return workflowError("status %q has an unknown category", name)
		}
	}
	for _, tr := range upd.Transitions {
		if strings.TrimSpace(tr.Name) == "" {
			return workflowError("every transition needs a name")
		}
		if tr.FromRef != nil && *tr.FromRef == tr.ToRef {
			return workflowError("transition %q cannot point at its own source", tr.Name)
		}
		for _, rule := range tr.Rules {
			if !ruleKinds[rule.Kind] {
				return workflowError("unknown rule kind %q", rule.Kind)
			}
			if len(rule.Config) > 0 && !json.Valid(rule.Config) {
				return workflowError("rule on %q has invalid configuration", tr.Name)
			}
		}
	}
	return nil
}
