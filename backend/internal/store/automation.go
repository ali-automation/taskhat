package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// AutomationActorEmail identifies the system user that performs rule actions.
const AutomationActorEmail = "automation@taskhat.local"

type AutomationRule struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	ScopeProjectID  *string         `json:"scopeProjectId"`
	ScopeProjectKey *string         `json:"scopeProjectKey"`
	Owner           *User           `json:"owner"`
	Trigger         json.RawMessage `json:"trigger"`
	Components      json.RawMessage `json:"components"`
	IsEnabled       bool            `json:"isEnabled"`
	AllowSelf       bool            `json:"allowSelfTrigger"`
	NotifyOnError   string          `json:"notifyOnError"`
	Failures        int             `json:"consecutiveFailures"`
	LastRunAt       *time.Time      `json:"lastRunAt"`
	NextRunAt       *time.Time      `json:"-"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

const automationSelect = `
SELECT r.id, r.name, r.description, r.scope_project_id, p.key,
       r.trigger, r.components, r.is_enabled, r.allow_self_trigger, r.notify_on_error,
       r.consecutive_failures, r.last_run_at, r.next_run_at, r.created_at, r.updated_at,
       o.id, o.email, o.display_name, o.avatar_url, o.is_active, o.created_at
FROM automation_rules r
LEFT JOIN projects p ON p.id = r.scope_project_id
LEFT JOIN users o ON o.id = r.owner_id
`

func scanAutomationRule(row pgx.Row) (AutomationRule, error) {
	var r AutomationRule
	var oID, oEmail, oName, oAvatar *string
	var oActive *bool
	var oCreated *time.Time
	err := row.Scan(&r.ID, &r.Name, &r.Description, &r.ScopeProjectID, &r.ScopeProjectKey,
		&r.Trigger, &r.Components, &r.IsEnabled, &r.AllowSelf, &r.NotifyOnError,
		&r.Failures, &r.LastRunAt, &r.NextRunAt, &r.CreatedAt, &r.UpdatedAt,
		&oID, &oEmail, &oName, &oAvatar, &oActive, &oCreated)
	if errors.Is(err, pgx.ErrNoRows) {
		return AutomationRule{}, ErrNotFound
	}
	if oID != nil {
		r.Owner = &User{ID: *oID, Email: *oEmail, DisplayName: *oName, AvatarURL: oAvatar, IsActive: *oActive, CreatedAt: *oCreated}
	}
	return r, err
}

func (s *Store) collectRules(rows pgx.Rows, err error) ([]AutomationRule, error) {
	if err != nil {
		return nil, fmt.Errorf("automation rules: %w", err)
	}
	defer rows.Close()
	rules := []AutomationRule{}
	for rows.Next() {
		r, err := scanAutomationRule(rows)
		if err != nil {
			return nil, err
		}
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

func (s *Store) ListAutomationRules(ctx context.Context) ([]AutomationRule, error) {
	return s.collectRules(s.pool.Query(ctx, automationSelect+` ORDER BY r.created_at`))
}

// EnabledRulesForEvent returns enabled, non-scheduled rules whose trigger
// listens for eventType and whose scope covers projectKey.
func (s *Store) EnabledRulesForEvent(ctx context.Context, eventType, projectKey string) ([]AutomationRule, error) {
	return s.collectRules(s.pool.Query(ctx, automationSelect+`
		WHERE r.is_enabled
		  AND (r.trigger->>'type' = $1
		       OR (r.trigger->>'type' = 'multiple' AND r.trigger->'events' ? $1))
		  AND (r.scope_project_id IS NULL OR p.key = $2)`, eventType, projectKey))
}

// DueScheduledRules claims scheduled rules whose next_run_at has passed and
// advances their clock so a single worker tick runs each rule once.
func (s *Store) DueScheduledRules(ctx context.Context) ([]AutomationRule, error) {
	rows, err := s.pool.Query(ctx, `
		UPDATE automation_rules r SET next_run_at = now() + (COALESCE(NULLIF(r.trigger->>'intervalMinutes','')::int, 60) || ' minutes')::interval
		WHERE r.is_enabled AND r.trigger->>'type' = 'scheduled'
		  AND (r.next_run_at IS NULL OR r.next_run_at <= now())
		RETURNING r.id`)
	if err != nil {
		return nil, fmt.Errorf("due rules: %w", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []AutomationRule{}, nil
	}
	return s.collectRules(s.pool.Query(ctx, automationSelect+` WHERE r.id = ANY($1)`, ids))
}

func (s *Store) GetAutomationRule(ctx context.Context, id string) (AutomationRule, error) {
	return scanAutomationRule(s.pool.QueryRow(ctx, automationSelect+` WHERE r.id = $1`, id))
}

type AutomationRuleInput struct {
	Name          string
	Description   string
	ScopeProject  *string // project id
	OwnerID       *string
	Trigger       json.RawMessage
	Components    json.RawMessage
	IsEnabled     bool
	AllowSelf     bool
	NotifyOnError string
}

func (s *Store) CreateAutomationRule(ctx context.Context, in AutomationRuleInput, createdBy string) (AutomationRule, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO automation_rules (name, description, scope_project_id, owner_id, trigger, components,
			is_enabled, allow_self_trigger, notify_on_error, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
		in.Name, in.Description, in.ScopeProject, in.OwnerID, in.Trigger, in.Components,
		in.IsEnabled, in.AllowSelf, in.NotifyOnError, createdBy).Scan(&id)
	if err != nil {
		return AutomationRule{}, fmt.Errorf("create rule: %w", err)
	}
	return s.GetAutomationRule(ctx, id)
}

func (s *Store) UpdateAutomationRule(ctx context.Context, id string, in AutomationRuleInput) (AutomationRule, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE automation_rules SET name = $2, description = $3, scope_project_id = $4, owner_id = $5,
			trigger = $6, components = $7, is_enabled = $8, allow_self_trigger = $9, notify_on_error = $10,
			consecutive_failures = CASE WHEN $8 AND NOT is_enabled THEN 0 ELSE consecutive_failures END,
			next_run_at = CASE WHEN trigger->>'type' <> 'scheduled' THEN NULL ELSE next_run_at END,
			updated_at = now()
		WHERE id = $1`,
		id, in.Name, in.Description, in.ScopeProject, in.OwnerID, in.Trigger, in.Components,
		in.IsEnabled, in.AllowSelf, in.NotifyOnError)
	if err != nil {
		return AutomationRule{}, fmt.Errorf("update rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return AutomationRule{}, ErrNotFound
	}
	return s.GetAutomationRule(ctx, id)
}

func (s *Store) DeleteAutomationRule(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM automation_rules WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RuleByIncomingToken finds an enabled incoming-webhook rule by its token.
func (s *Store) RuleByIncomingToken(ctx context.Context, token string) (AutomationRule, error) {
	return scanAutomationRule(s.pool.QueryRow(ctx, automationSelect+`
		WHERE r.is_enabled AND r.trigger->>'type' = 'incoming' AND r.trigger->>'token' = $1`, token))
}

// ManualRulesForProject lists enabled manual-trigger rules usable in a space.
func (s *Store) ManualRulesForProject(ctx context.Context, projectKey string) ([]AutomationRule, error) {
	return s.collectRules(s.pool.Query(ctx, automationSelect+`
		WHERE r.is_enabled AND r.trigger->>'type' = 'manual'
		  AND (r.scope_project_id IS NULL OR p.key = $1)
		ORDER BY r.name`, projectKey))
}

// ListAutomationRulesForProject lists rules scoped to one space plus global
// ones (the space Automation tab shows both; global are read-only there).
func (s *Store) ListAutomationRulesForProject(ctx context.Context, projectID string) ([]AutomationRule, error) {
	return s.collectRules(s.pool.Query(ctx, automationSelect+`
		WHERE r.scope_project_id = $1 OR r.scope_project_id IS NULL
		ORDER BY r.scope_project_id NULLS LAST, r.created_at`, projectID))
}

// ---- run outcomes & failure bookkeeping ----

type AutomationRun struct {
	ID         string          `json:"id"`
	EventType  string          `json:"eventType"`
	ItemKey    string          `json:"itemKey"`
	Status     string          `json:"status"`
	Log        json.RawMessage `json:"log"`
	DurationMS int             `json:"durationMs"`
	CreatedAt  time.Time       `json:"createdAt"`
}

// RecordAutomationRun logs a run, updates failure counters, and reports
// whether the rule was auto-disabled by this failure.
func (s *Store) RecordAutomationRun(ctx context.Context, ruleID, eventType, itemKey, status string, log any, durationMS int, disableAfter int) (autoDisabled bool, failures int) {
	raw, err := json.Marshal(log)
	if err != nil {
		raw = []byte("[]")
	}
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO automation_runs (rule_id, event_type, item_key, status, log, duration_ms)
		VALUES ($1, $2, $3, $4, $5, $6)`, ruleID, eventType, itemKey, status, raw, durationMS)
	_, _ = s.pool.Exec(ctx, `
		DELETE FROM automation_runs WHERE rule_id = $1 AND id NOT IN (
			SELECT id FROM automation_runs WHERE rule_id = $1 ORDER BY created_at DESC LIMIT 200)`, ruleID)

	if status == "failure" {
		_ = s.pool.QueryRow(ctx, `
			UPDATE automation_rules
			SET consecutive_failures = consecutive_failures + 1, last_run_at = now(),
			    is_enabled = CASE WHEN consecutive_failures + 1 >= $2 THEN FALSE ELSE is_enabled END
			WHERE id = $1
			RETURNING consecutive_failures, NOT is_enabled`, ruleID, disableAfter).Scan(&failures, &autoDisabled)
		return autoDisabled, failures
	}
	_, _ = s.pool.Exec(ctx,
		`UPDATE automation_rules SET consecutive_failures = 0, last_run_at = now() WHERE id = $1`, ruleID)
	return false, 0
}

func (s *Store) ListAutomationRuns(ctx context.Context, ruleID string, limit int) ([]AutomationRun, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, event_type, item_key, status, log, duration_ms, created_at
		FROM automation_runs WHERE rule_id = $1 ORDER BY created_at DESC LIMIT $2`, ruleID, limit)
	if err != nil {
		return nil, fmt.Errorf("runs: %w", err)
	}
	defer rows.Close()
	runs := []AutomationRun{}
	for rows.Next() {
		var r AutomationRun
		if err := rows.Scan(&r.ID, &r.EventType, &r.ItemKey, &r.Status, &r.Log, &r.DurationMS, &r.CreatedAt); err != nil {
			return nil, err
		}
		runs = append(runs, r)
	}
	return runs, rows.Err()
}

// ---- engine helpers ----

// AutomationActorID resolves the system user's id (cached by the engine).
func (s *Store) AutomationActorID(ctx context.Context) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM users WHERE email = $1`, AutomationActorEmail).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// IssueMatchesTQL evaluates a compiled TQL fragment against one issue.
func (s *Store) IssueMatchesTQL(ctx context.Context, issueID, whereSQL string, whereArgs []any) (bool, error) {
	where := `i.id = $1`
	if whereSQL != "" {
		where += " AND (" + numberPlaceholders(whereSQL, 2) + ")"
	}
	args := append([]any{issueID}, whereArgs...)
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM issues i
		JOIN projects p ON p.id = i.project_id
		JOIN statuses s ON s.id = i.status_id
		LEFT JOIN sprints sp ON sp.id = i.sprint_id
		WHERE `+where+`)`, args...).Scan(&ok)
	return ok, err
}

// SearchIssuesUnscoped runs TQL without membership scoping (automation is
// site-level); archived spaces stay excluded.
func (s *Store) SearchIssuesUnscoped(ctx context.Context, whereSQL string, whereArgs []any, limit int) ([]Issue, error) {
	where := `p.archived_at IS NULL`
	if whereSQL != "" {
		where += " AND (" + numberPlaceholders(whereSQL, 1) + ")"
	}
	args := append([]any{}, whereArgs...)
	args = append(args, limit)
	rows, err := s.pool.Query(ctx,
		issueSelect+` WHERE `+where+fmt.Sprintf(` ORDER BY i.updated_at DESC LIMIT $%d`, len(args)),
		args...)
	if err != nil {
		return nil, fmt.Errorf("unscoped search: %w", err)
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

// RelatedIssues resolves a branch relation for an issue.
func (s *Store) RelatedIssues(ctx context.Context, issue Issue, relation string) ([]Issue, error) {
	var where string
	var args []any
	switch relation {
	case "parent":
		if issue.Parent == nil {
			return []Issue{}, nil
		}
		where, args = `i.id = $1`, []any{issue.Parent.ID}
	case "children": // direct children of any type (sub-tasks + epic items)
		where, args = `i.parent_id = $1`, []any{issue.ID}
	case "subtasks":
		where, args = `i.parent_id = $1 AND i.type = 'subtask'`, []any{issue.ID}
	case "epic": // the epic this item belongs to (parent of type epic)
		if issue.Parent == nil {
			return []Issue{}, nil
		}
		where, args = `i.id = $1 AND i.type = 'epic'`, []any{issue.Parent.ID}
	default:
		return nil, fmt.Errorf("unknown relation %q", relation)
	}
	rows, err := s.pool.Query(ctx, issueSelect+` WHERE `+where+` ORDER BY i.number`, args...)
	if err != nil {
		return nil, fmt.Errorf("related issues: %w", err)
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

// StatusIDByName resolves a status name inside an issue's workflow.
func (s *Store) StatusIDByName(ctx context.Context, workflowID, name string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM statuses WHERE workflow_id = $1 AND lower(name) = lower($2)`, workflowID, name).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}
