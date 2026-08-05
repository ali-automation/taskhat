package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrTypeInUse            = errors.New("work items of this type exist")
	ErrTypeBuiltin          = errors.New("built-in work types cannot be deleted")
	ErrTypeTaken            = errors.New("a work type with this name already exists")
	ErrFieldTaken           = errors.New("a field with this name already exists")
	ErrTransitionNotAllowed = errors.New("transition not allowed by the workflow")
)

// ---- work types ----

type WorkType struct {
	ID        string    `json:"id"`
	Key       string    `json:"key"`
	Name      string    `json:"name"`
	Glyph     string    `json:"glyph"`
	Color     string    `json:"color"`
	IsEnabled bool      `json:"isEnabled"`
	Builtin   bool      `json:"builtin"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
}

const workTypeCols = `id, key, name, glyph, color, is_enabled, builtin, position, created_at`

func scanWorkType(row pgx.Row) (WorkType, error) {
	var t WorkType
	err := row.Scan(&t.ID, &t.Key, &t.Name, &t.Glyph, &t.Color, &t.IsEnabled, &t.Builtin, &t.Position, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkType{}, ErrNotFound
	}
	return t, err
}

func (s *Store) ListWorkTypes(ctx context.Context, includeDisabled bool) ([]WorkType, error) {
	where := ""
	if !includeDisabled {
		where = ` WHERE is_enabled`
	}
	rows, err := s.pool.Query(ctx, `SELECT `+workTypeCols+` FROM work_types`+where+` ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("list work types: %w", err)
	}
	defer rows.Close()
	types := []WorkType{}
	for rows.Next() {
		t, err := scanWorkType(rows)
		if err != nil {
			return nil, err
		}
		types = append(types, t)
	}
	return types, rows.Err()
}

// WorkTypeEnabled reports whether key is a known, enabled work type.
func (s *Store) WorkTypeEnabled(ctx context.Context, key string) (bool, error) {
	var enabled bool
	err := s.pool.QueryRow(ctx,
		`SELECT is_enabled FROM work_types WHERE key = $1`, key).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return enabled, err
}

var nonSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

func (s *Store) CreateWorkType(ctx context.Context, name, glyph, color string) (WorkType, error) {
	key := strings.Trim(nonSlugRe.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if key == "" {
		key = "type"
	}
	t, err := scanWorkType(s.pool.QueryRow(ctx, `
		INSERT INTO work_types (key, name, glyph, color, position)
		VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(position), 0) + 1 FROM work_types))
		RETURNING `+workTypeCols, key, name, glyph, color))
	if isUniqueViolation(err) {
		return WorkType{}, ErrTypeTaken
	}
	if err != nil {
		return WorkType{}, fmt.Errorf("create work type: %w", err)
	}
	return t, nil
}

func (s *Store) UpdateWorkType(ctx context.Context, id, name, glyph, color string, enabled bool) (WorkType, error) {
	t, err := scanWorkType(s.pool.QueryRow(ctx, `
		UPDATE work_types SET name = $2, glyph = $3, color = $4, is_enabled = $5
		WHERE id = $1 RETURNING `+workTypeCols, id, name, glyph, color, enabled))
	if err != nil && !errors.Is(err, ErrNotFound) {
		return WorkType{}, fmt.Errorf("update work type: %w", err)
	}
	return t, err
}

func (s *Store) DeleteWorkType(ctx context.Context, id string) error {
	var key string
	var builtin bool
	err := s.pool.QueryRow(ctx, `SELECT key, builtin FROM work_types WHERE id = $1`, id).Scan(&key, &builtin)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if builtin {
		return ErrTypeBuiltin
	}
	var used bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM issues WHERE type = $1)`, key).Scan(&used); err != nil {
		return err
	}
	if used {
		return ErrTypeInUse
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM work_types WHERE id = $1`, id)
	return err
}

// ---- custom fields ----

type CustomField struct {
	ID         string   `json:"id"`
	ProjectID  *string  `json:"projectId"` // nil = all spaces
	ProjectKey *string  `json:"projectKey"`
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Options    []string `json:"options"`
	Position   int      `json:"position"`
	UsageCount int      `json:"usageCount"`
}

const customFieldSelect = `
SELECT f.id, f.project_id, p.key, f.name, f.type, f.options, f.position,
       (SELECT count(*) FROM issue_field_values v WHERE v.field_id = f.id)
FROM custom_fields f
LEFT JOIN projects p ON p.id = f.project_id
`

func scanCustomField(row pgx.Row) (CustomField, error) {
	var f CustomField
	err := row.Scan(&f.ID, &f.ProjectID, &f.ProjectKey, &f.Name, &f.Type, &f.Options, &f.Position, &f.UsageCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomField{}, ErrNotFound
	}
	return f, err
}

func (s *Store) collectCustomFields(rows pgx.Rows, err error) ([]CustomField, error) {
	if err != nil {
		return nil, fmt.Errorf("custom fields: %w", err)
	}
	defer rows.Close()
	fields := []CustomField{}
	for rows.Next() {
		f, err := scanCustomField(rows)
		if err != nil {
			return nil, err
		}
		fields = append(fields, f)
	}
	return fields, rows.Err()
}

// ListProjectFields returns the fields applicable to a project (global + own).
func (s *Store) ListProjectFields(ctx context.Context, projectID string) ([]CustomField, error) {
	return s.collectCustomFields(s.pool.Query(ctx,
		customFieldSelect+` WHERE f.project_id IS NULL OR f.project_id = $1 ORDER BY f.position, f.name`, projectID))
}

func (s *Store) ListAllCustomFields(ctx context.Context) ([]CustomField, error) {
	return s.collectCustomFields(s.pool.Query(ctx,
		customFieldSelect+` ORDER BY f.project_id NULLS FIRST, f.position, f.name`))
}

func (s *Store) GetCustomField(ctx context.Context, id string) (CustomField, error) {
	return scanCustomField(s.pool.QueryRow(ctx, customFieldSelect+` WHERE f.id = $1`, id))
}

// CustomFieldIDsByName resolves a TQL cf["Name"] reference (any scope).
func (s *Store) CustomFieldIDsByName(ctx context.Context, name string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id FROM custom_fields WHERE lower(name) = lower($1)`, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) CreateCustomField(ctx context.Context, projectID *string, name, ftype string, options []string) (CustomField, error) {
	raw, err := json.Marshal(options)
	if err != nil {
		return CustomField{}, err
	}
	var id string
	err = s.pool.QueryRow(ctx, `
		INSERT INTO custom_fields (project_id, name, type, options, position)
		VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(position), 0) + 1 FROM custom_fields))
		RETURNING id`, projectID, name, ftype, raw).Scan(&id)
	if isUniqueViolation(err) {
		return CustomField{}, ErrFieldTaken
	}
	if err != nil {
		return CustomField{}, fmt.Errorf("create field: %w", err)
	}
	return s.GetCustomField(ctx, id)
}

func (s *Store) UpdateCustomField(ctx context.Context, id, name string, options []string) (CustomField, error) {
	raw, err := json.Marshal(options)
	if err != nil {
		return CustomField{}, err
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE custom_fields SET name = $2, options = $3 WHERE id = $1`, id, name, raw)
	if isUniqueViolation(err) {
		return CustomField{}, ErrFieldTaken
	}
	if err != nil {
		return CustomField{}, fmt.Errorf("update field: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return CustomField{}, ErrNotFound
	}
	return s.GetCustomField(ctx, id)
}

func (s *Store) DeleteCustomField(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM custom_fields WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete field: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// validateFieldValue normalizes a raw value against the field definition.
// Returns nil to clear the value.
func validateFieldValue(f CustomField, raw any) (any, error) {
	if raw == nil {
		return nil, nil
	}
	switch f.Type {
	case "number":
		n, ok := raw.(float64)
		if !ok {
			return nil, fmt.Errorf("%s expects a number", f.Name)
		}
		return n, nil
	case "date":
		str, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("%s expects a YYYY-MM-DD date", f.Name)
		}
		if str == "" {
			return nil, nil
		}
		if _, err := time.Parse("2006-01-02", str); err != nil {
			return nil, fmt.Errorf("%s expects a YYYY-MM-DD date", f.Name)
		}
		return str, nil
	case "select":
		str, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("%s expects one of its options", f.Name)
		}
		if str == "" {
			return nil, nil
		}
		for _, o := range f.Options {
			if o == str {
				return str, nil
			}
		}
		return nil, fmt.Errorf("%q is not an option of %s", str, f.Name)
	default: // text
		str, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("%s expects text", f.Name)
		}
		if strings.TrimSpace(str) == "" {
			return nil, nil
		}
		return str, nil
	}
}

// SetIssueFieldValues validates and upserts custom values for an issue; a nil
// (or empty) value clears the field. Returns changelog entries (field name,
// old, new) for values that actually changed.
type FieldChange struct {
	FieldName string
	Old       any
	New       any
}

func (s *Store) SetIssueFieldValues(ctx context.Context, issueID, projectID string, values map[string]any) ([]FieldChange, error) {
	applicable, err := s.ListProjectFields(ctx, projectID)
	if err != nil {
		return nil, err
	}
	byID := map[string]CustomField{}
	for _, f := range applicable {
		byID[f.ID] = f
	}

	changes := []FieldChange{}
	for fieldID, raw := range values {
		f, ok := byID[fieldID]
		if !ok {
			return nil, fmt.Errorf("unknown field %s for this space", fieldID)
		}
		val, err := validateFieldValue(f, raw)
		if err != nil {
			return nil, err
		}

		var old any
		var oldRaw []byte
		err = s.pool.QueryRow(ctx,
			`SELECT value FROM issue_field_values WHERE issue_id = $1 AND field_id = $2`,
			issueID, fieldID).Scan(&oldRaw)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if oldRaw != nil {
			_ = json.Unmarshal(oldRaw, &old)
		}

		if val == nil {
			if oldRaw == nil {
				continue
			}
			if _, err := s.pool.Exec(ctx,
				`DELETE FROM issue_field_values WHERE issue_id = $1 AND field_id = $2`, issueID, fieldID); err != nil {
				return nil, err
			}
			changes = append(changes, FieldChange{f.Name, old, nil})
			continue
		}
		if old == val {
			continue
		}
		raw, err := json.Marshal(val)
		if err != nil {
			return nil, err
		}
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO issue_field_values (issue_id, field_id, value) VALUES ($1, $2, $3)
			ON CONFLICT (issue_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
			issueID, fieldID, raw); err != nil {
			return nil, err
		}
		changes = append(changes, FieldChange{f.Name, old, val})
	}
	return changes, nil
}

// RecordFieldChanges writes changelog rows for custom field edits.
func (s *Store) RecordFieldChanges(ctx context.Context, issueID, actorID string, changes []FieldChange) {
	for _, c := range changes {
		_, _ = s.pool.Exec(ctx,
			`INSERT INTO issue_events (issue_id, actor_id, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5)`,
			issueID, actorID, c.FieldName, jsonVal(c.Old), jsonVal(c.New))
	}
}

// ---- workflow transitions (the editor makes the Stage-1 table real) ----

type Transition struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	From *Status `json:"from"` // nil = from any status
	To   Status  `json:"to"`
}

func (s *Store) ListWorkflowTransitions(ctx context.Context, workflowID string) ([]Transition, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.name,
		       f.id, f.name, f.category, f.position,
		       o.id, o.name, o.category, o.position
		FROM transitions t
		LEFT JOIN statuses f ON f.id = t.from_status_id
		JOIN statuses o ON o.id = t.to_status_id
		WHERE t.workflow_id = $1
		ORDER BY o.position, f.position NULLS FIRST`, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list transitions: %w", err)
	}
	defer rows.Close()
	transitions := []Transition{}
	for rows.Next() {
		var t Transition
		var fID, fName, fCat *string
		var fPos *int
		if err := rows.Scan(&t.ID, &t.Name, &fID, &fName, &fCat, &fPos,
			&t.To.ID, &t.To.Name, &t.To.Category, &t.To.Position); err != nil {
			return nil, err
		}
		if fID != nil {
			t.From = &Status{ID: *fID, Name: *fName, Category: *fCat, Position: *fPos}
		}
		transitions = append(transitions, t)
	}
	return transitions, rows.Err()
}

// ListAvailableTransitions returns the transitions usable from a status.
func (s *Store) ListAvailableTransitions(ctx context.Context, workflowID, fromStatusID string) ([]Transition, error) {
	all, err := s.ListWorkflowTransitions(ctx, workflowID)
	if err != nil {
		return nil, err
	}
	out := []Transition{}
	for _, t := range all {
		if t.To.ID == fromStatusID {
			continue
		}
		if t.From == nil || t.From.ID == fromStatusID {
			out = append(out, t)
		}
	}
	return out, nil
}

func (s *Store) CreateTransition(ctx context.Context, workflowID, name string, fromStatusID *string, toStatusID string) (Transition, error) {
	// Both endpoints must belong to this workflow.
	var count int
	ids := []string{toStatusID}
	if fromStatusID != nil {
		ids = append(ids, *fromStatusID)
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM statuses WHERE workflow_id = $1 AND id = ANY($2)`,
		workflowID, ids).Scan(&count); err != nil {
		return Transition{}, err
	}
	if count != len(ids) {
		return Transition{}, ErrNotFound
	}
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO transitions (workflow_id, from_status_id, to_status_id, name)
		VALUES ($1, $2, $3, $4) RETURNING id`,
		workflowID, fromStatusID, toStatusID, name).Scan(&id); err != nil {
		return Transition{}, fmt.Errorf("create transition: %w", err)
	}
	_, _ = s.pool.Exec(ctx, `UPDATE workflows SET updated_at = now() WHERE id = $1`, workflowID)
	all, err := s.ListWorkflowTransitions(ctx, workflowID)
	if err != nil {
		return Transition{}, err
	}
	for _, t := range all {
		if t.ID == id {
			return t, nil
		}
	}
	return Transition{}, ErrNotFound
}

func (s *Store) DeleteTransition(ctx context.Context, workflowID, transitionID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM transitions WHERE workflow_id = $1 AND id = $2`, workflowID, transitionID)
	if err != nil {
		return fmt.Errorf("delete transition: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_, _ = s.pool.Exec(ctx, `UPDATE workflows SET updated_at = now() WHERE id = $1`, workflowID)
	return nil
}

// resolveTransitionTarget maps a transition reference (a transition row id, or
// a bare target status id from board drags) to the target status id and the
// transition row taken, enforcing the workflow. Returns ErrTransitionNotAllowed
// when the move isn't permitted.
func resolveTransitionTargetTx(ctx context.Context, tx pgx.Tx, workflowID, currentStatusID, ref string) (string, string, error) {
	// Transition row id?
	var toID string
	var fromID *string
	err := tx.QueryRow(ctx,
		`SELECT to_status_id, from_status_id FROM transitions WHERE workflow_id = $1 AND id = $2`,
		workflowID, ref).Scan(&toID, &fromID)
	if err == nil {
		if fromID != nil && *fromID != currentStatusID {
			return "", "", ErrTransitionNotAllowed
		}
		return toID, ref, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", err
	}
	// Bare status id: pick a matching transition, preferring a status-specific
	// one over a global (from-any) one so its rules apply.
	var trID string
	err = tx.QueryRow(ctx, `
		SELECT id FROM transitions
		WHERE workflow_id = $1 AND to_status_id = $2
		  AND (from_status_id IS NULL OR from_status_id = $3)
		ORDER BY (from_status_id IS NULL) LIMIT 1`,
		workflowID, ref, currentStatusID).Scan(&trID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrTransitionNotAllowed
	}
	if err != nil {
		return "", "", err
	}
	return ref, trID, nil
}

// RuleViolation is a transition blocked by a workflow rule; Forbidden
// distinguishes "you may not" (403) from "the work item isn't ready" (400).
type RuleViolation struct {
	Forbidden bool
	Msg       string
}

func (e *RuleViolation) Error() string { return e.Msg }

// applyTransitionRulesTx checks the transition's rules against the issue and
// actor. It returns the auto-assign target ("actor", "" for unassign, or a
// user id) when an auto-assign post function should run, nil otherwise.
func applyTransitionRulesTx(ctx context.Context, tx pgx.Tx, cur *Issue, transitionID, actorID string) (*string, error) {
	rows, err := tx.Query(ctx,
		`SELECT kind, config FROM transition_rules WHERE transition_id = $1 ORDER BY created_at`, transitionID)
	if err != nil {
		return nil, fmt.Errorf("transition rules: %w", err)
	}
	type rule struct {
		kind   string
		config []byte
	}
	var rules []rule
	for rows.Next() {
		var ru rule
		if err := rows.Scan(&ru.kind, &ru.config); err != nil {
			rows.Close()
			return nil, err
		}
		rules = append(rules, ru)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(rules) == 0 {
		return nil, nil
	}

	var autoAssign *string
	for _, ru := range rules {
		switch ru.kind {
		case "restrict-who":
			var cfg struct {
				Users []string `json:"users"`
				Roles []string `json:"roles"`
			}
			if err := json.Unmarshal(ru.config, &cfg); err != nil {
				return nil, fmt.Errorf("restrict-who config: %w", err)
			}
			ok, err := actorMatchesRestrictionTx(ctx, tx, cur, actorID, cfg.Users, cfg.Roles)
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, &RuleViolation{Forbidden: true,
					Msg: "a workflow rule restricts who can make this transition"}
			}
		case "required-field":
			var cfg struct {
				Fields []string `json:"fields"`
			}
			if err := json.Unmarshal(ru.config, &cfg); err != nil {
				return nil, fmt.Errorf("required-field config: %w", err)
			}
			for _, f := range cfg.Fields {
				missing := false
				label := f
				switch f {
				case "description":
					missing = strings.TrimSpace(cur.Description) == ""
					label = "Description"
				case "assignee":
					missing = cur.Assignee == nil
					label = "Assignee"
				case "duedate":
					missing = cur.DueDate == nil
					label = "Due date"
				case "storypoints":
					missing = cur.StoryPoints == nil
					label = "Story points"
				}
				if missing {
					return nil, &RuleViolation{
						Msg: label + " must be filled before this transition can run"}
				}
			}
		case "auto-assign":
			var cfg struct {
				Assignee string `json:"assignee"`
			}
			if err := json.Unmarshal(ru.config, &cfg); err != nil {
				return nil, fmt.Errorf("auto-assign config: %w", err)
			}
			a := cfg.Assignee
			autoAssign = &a
		}
	}
	return autoAssign, nil
}

// actorMatchesRestrictionTx evaluates a restrict-who rule. Site admins always
// pass, matching how they implicitly hold every space permission.
func actorMatchesRestrictionTx(ctx context.Context, tx pgx.Tx, cur *Issue, actorID string, users, roles []string) (bool, error) {
	for _, u := range users {
		if u == actorID {
			return true, nil
		}
	}
	var leadID string
	var memberRole *string
	var isSiteAdmin bool
	if err := tx.QueryRow(ctx, `
		SELECT p.lead_id, m.role, u.is_admin
		FROM projects p
		JOIN users u ON u.id = $2
		LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
		WHERE p.id = $1`, cur.ProjectID, actorID).Scan(&leadID, &memberRole, &isSiteAdmin); err != nil {
		return false, fmt.Errorf("restriction lookup: %w", err)
	}
	if isSiteAdmin {
		return true, nil
	}
	for _, role := range roles {
		switch role {
		case "lead":
			if leadID == actorID {
				return true, nil
			}
		case "assignee":
			if cur.Assignee != nil && cur.Assignee.ID == actorID {
				return true, nil
			}
		case "reporter":
			if cur.Reporter.ID == actorID {
				return true, nil
			}
		case "admin":
			if memberRole != nil && *memberRole == "admin" {
				return true, nil
			}
		case "member":
			if memberRole != nil && (*memberRole == "admin" || *memberRole == "member") {
				return true, nil
			}
		}
	}
	return false, nil
}
