package store

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type ImportJob struct {
	ID         string          `json:"id"`
	OwnerID    string          `json:"-"`
	Source     string          `json:"source"`
	ProjectKey string          `json:"projectKey"`
	Status     string          `json:"status"`
	Config     json.RawMessage `json:"-"` // may hold credentials; never serialized out
	Stats      json.RawMessage `json:"stats"`
	Error      string          `json:"error"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

const importJobCols = `id, owner_id, source, project_key, status, config, stats, error, created_at, updated_at`

func scanImportJob(row pgx.Row) (ImportJob, error) {
	var j ImportJob
	err := row.Scan(&j.ID, &j.OwnerID, &j.Source, &j.ProjectKey, &j.Status, &j.Config, &j.Stats,
		&j.Error, &j.CreatedAt, &j.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ImportJob{}, ErrNotFound
	}
	return j, err
}

func (s *Store) CreateImportJob(ctx context.Context, ownerID, source, projectKey string, config any) (ImportJob, error) {
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO import_jobs (owner_id, source, project_key, config) VALUES ($1, $2, $3, $4) RETURNING id`,
		ownerID, source, strings.ToUpper(projectKey), jsonVal(config)).Scan(&id); err != nil {
		return ImportJob{}, fmt.Errorf("create import job: %w", err)
	}
	return s.GetImportJob(ctx, id)
}

func (s *Store) GetImportJob(ctx context.Context, id string) (ImportJob, error) {
	return scanImportJob(s.pool.QueryRow(ctx, `SELECT `+importJobCols+` FROM import_jobs WHERE id = $1`, id))
}

// importJobBlobKeys derives the storage keys a job may hold: the scan
// snapshot and, for CSV imports, the uploaded file.
func importJobBlobKeys(id string, config []byte) []string {
	keys := []string{"imports/" + id + ".json"}
	var cfg struct {
		CSVKey string `json:"csvKey"`
	}
	_ = json.Unmarshal(config, &cfg)
	if cfg.CSVKey != "" {
		keys = append(keys, cfg.CSVKey)
	}
	return keys
}

// DeleteImportJob removes one job (the caller checks ownership), returning
// the blob keys to delete from storage.
func (s *Store) DeleteImportJob(ctx context.Context, id string) ([]string, error) {
	var config []byte
	err := s.pool.QueryRow(ctx,
		`DELETE FROM import_jobs WHERE id = $1 RETURNING config`, id).Scan(&config)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("delete import job: %w", err)
	}
	return importJobBlobKeys(id, config), nil
}

// DeleteImportJobsForTarget removes every import job that targeted a deleted
// space, returning their blob keys. wiki=true matches Confluence jobs (whose
// target key lives in config), wiki=false matches Jira/CSV jobs.
func (s *Store) DeleteImportJobsForTarget(ctx context.Context, key string, wiki bool) ([]string, error) {
	var q string
	if wiki {
		q = `DELETE FROM import_jobs WHERE source = 'confluence_api'
		       AND (upper(config ->> 'targetKey') = upper($1)
		            OR ((config ->> 'targetKey' IS NULL OR config ->> 'targetKey' = '') AND upper(project_key) = upper($1)))
		     RETURNING id, config`
	} else {
		q = `DELETE FROM import_jobs WHERE source <> 'confluence_api' AND upper(project_key) = upper($1)
		     RETURNING id, config`
	}
	rows, err := s.pool.Query(ctx, q, key)
	if err != nil {
		return nil, fmt.Errorf("delete import jobs for %s: %w", key, err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var id string
		var config []byte
		if err := rows.Scan(&id, &config); err != nil {
			return nil, err
		}
		keys = append(keys, importJobBlobKeys(id, config)...)
	}
	return keys, rows.Err()
}

func (s *Store) ListImportJobs(ctx context.Context, ownerID string, limit int) ([]ImportJob, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+importJobCols+` FROM import_jobs WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`,
		ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list import jobs: %w", err)
	}
	defer rows.Close()
	jobs := []ImportJob{}
	for rows.Next() {
		j, err := scanImportJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

func (s *Store) SetImportJobStatus(ctx context.Context, id, status, errMsg string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE import_jobs SET status = $2, error = $3, updated_at = now() WHERE id = $1`, id, status, errMsg)
	return err
}

func (s *Store) SetImportJobStats(ctx context.Context, id string, stats any) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE import_jobs SET stats = $2, updated_at = now() WHERE id = $1`, id, jsonVal(stats))
	return err
}

// ---- import upserts ----

// ImportEnsureProject returns the project with the key, creating it (with a
// default board, owner as lead/admin) when missing.
func (s *Store) ImportEnsureProject(ctx context.Context, key, name, projectType, ownerID string) (Project, error) {
	project, err := s.GetProjectByKey(ctx, key)
	if err == nil {
		// Make sure the importer is a member (admin) so results are visible.
		if addErr := s.AddMember(ctx, project.ID, ownerID, "admin"); addErr != nil {
			return Project{}, addErr
		}
		return project, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return Project{}, err
	}
	if name == "" {
		name = key
	}
	return s.CreateProject(ctx, key, name, "Imported from Jira", projectType, ownerID)
}

// ImportBoardColumn is one target column for ImportSetBoardColumns.
type ImportBoardColumn struct {
	Name      string
	StatusIDs []string
}

// ImportSetBoardColumns rebuilds a board's columns to match an imported
// layout (Jira column → mapped statuses), replacing whatever was there.
func (s *Store) ImportSetBoardColumns(ctx context.Context, boardID string, cols []ImportBoardColumn) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM board_columns WHERE board_id = $1`, boardID); err != nil {
		return fmt.Errorf("clear columns: %w", err)
	}
	for i, col := range cols {
		var colID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO board_columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id`,
			boardID, col.Name, i+1).Scan(&colID); err != nil {
			return fmt.Errorf("insert column: %w", err)
		}
		for _, statusID := range col.StatusIDs {
			if _, err := tx.Exec(ctx,
				`INSERT INTO board_column_statuses (column_id, status_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
				colID, statusID); err != nil {
				return fmt.Errorf("map column status: %w", err)
			}
		}
	}
	return tx.Commit(ctx)
}

// FormatJiraDuration renders seconds the way Jira does (8h days, 5d weeks).
func FormatJiraDuration(sec int64) string {
	if sec <= 0 {
		return "0m"
	}
	units := []struct {
		label string
		size  int64
	}{{"w", 144000}, {"d", 28800}, {"h", 3600}, {"m", 60}}
	out := ""
	for _, u := range units {
		if n := sec / u.size; n > 0 {
			if out != "" {
				out += " "
			}
			out += fmt.Sprintf("%d%s", n, u.label)
			sec -= n * u.size
		}
	}
	if out == "" {
		return "0m"
	}
	return out
}

// ImportRetireCustomFields deletes imported custom-field defs (values cascade)
// that a newer import maps elsewhere — e.g. site-specific "Story point
// estimate" fields that now feed the native story-points field. Names are
// matched lowercased.
func (s *Store) ImportRetireCustomFields(ctx context.Context, projectID string, names []string) error {
	if len(names) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		DELETE FROM custom_fields WHERE project_id = $1 AND lower(name) = ANY($2)`,
		projectID, names)
	if err != nil {
		return fmt.Errorf("retire custom fields: %w", err)
	}
	return nil
}

// ImportCleanHistory repairs previously imported changelogs: bookkeeping
// events Jira never shows are dropped, and time-tracking values recorded as
// raw seconds are reformatted as durations under Jira's field labels.
func (s *Store) ImportCleanHistory(ctx context.Context, projectID string) error {
	if _, err := s.pool.Exec(ctx, `
		DELETE FROM issue_events e USING issues i
		WHERE e.issue_id = i.id AND i.project_id = $1
		  AND e.field IN ('worklogid', 'workratio', 'rank')`, projectID); err != nil {
		return fmt.Errorf("clean history: %w", err)
	}
	rename := map[string]string{
		"timespent": "time spent", "timeestimate": "remaining estimate",
		"timeoriginalestimate": "original estimate",
	}
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.field, e.old_value, e.new_value FROM issue_events e
		JOIN issues i ON i.id = e.issue_id
		WHERE i.project_id = $1 AND e.field IN ('timespent', 'timeestimate', 'timeoriginalestimate')`, projectID)
	if err != nil {
		return err
	}
	type ev struct {
		id, field string
		oldV, newV []byte
	}
	var evs []ev
	for rows.Next() {
		var e ev
		if err := rows.Scan(&e.id, &e.field, &e.oldV, &e.newV); err != nil {
			rows.Close()
			return err
		}
		evs = append(evs, e)
	}
	rows.Close()
	reformat := func(raw []byte) []byte {
		var v string
		if json.Unmarshal(raw, &v) != nil || v == "" {
			return raw
		}
		var n int64
		if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
			return raw
		}
		b, _ := json.Marshal(FormatJiraDuration(n))
		return b
	}
	for _, e := range evs {
		if _, err := s.pool.Exec(ctx,
			`UPDATE issue_events SET field = $2, old_value = $3, new_value = $4 WHERE id = $1`,
			e.id, rename[e.field], reformat(e.oldV), reformat(e.newV)); err != nil {
			return err
		}
	}
	return nil
}

// ImportRenameBoard applies the source board's name.
func (s *Store) ImportRenameBoard(ctx context.Context, boardID, name string) error {
	_, err := s.pool.Exec(ctx, `UPDATE boards SET name = $2 WHERE id = $1 AND name <> $2`, boardID, name)
	return err
}

// AllJiraAccountIDs lists the Jira account ids already linked to users —
// the scan report uses it to show which people will match instead of
// getting placeholders.
func (s *Store) AllJiraAccountIDs(ctx context.Context) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT jira_account_id FROM users WHERE jira_account_id IS NOT NULL`)
	if err != nil {
		return nil, fmt.Errorf("jira account ids: %w", err)
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}

// ImportUpsertUser finds a user by Jira account id, then email; otherwise
// creates a deactivated placeholder that can be re-linked later.
func (s *Store) ImportUpsertUser(ctx context.Context, accountID, email, displayName string) (string, error) {
	var id string
	if accountID != "" {
		err := s.pool.QueryRow(ctx, `SELECT id FROM users WHERE jira_account_id = $1`, accountID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	if email != "" {
		err := s.pool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&id)
		if err == nil {
			if accountID != "" {
				_, _ = s.pool.Exec(ctx, `UPDATE users SET jira_account_id = $2 WHERE id = $1 AND jira_account_id IS NULL`, id, accountID)
			}
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	if email == "" {
		slug := accountID
		if slug == "" {
			slug = strings.ToLower(strings.ReplaceAll(displayName, " ", "."))
		}
		email = "jira-" + slug + "@imported.invalid"
	}
	if displayName == "" {
		displayName = email
	}
	buf := make([]byte, 24)
	rand.Read(buf)
	unusablePassword := "$argon2id$imported$" + base64.RawStdEncoding.EncodeToString(buf)
	var acct *string
	if accountID != "" {
		acct = &accountID
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, is_active, jira_account_id)
		VALUES ($1, $2, $3, FALSE, $4)
		ON CONFLICT (email) DO UPDATE SET jira_account_id = COALESCE(users.jira_account_id, EXCLUDED.jira_account_id)
		RETURNING id`, email, unusablePassword, displayName, acct).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("import user: %w", err)
	}
	return id, nil
}

// ImportUpsertSprint upserts by (board, name).
func (s *Store) ImportUpsertSprint(ctx context.Context, boardID, name, state string, startAt, endAt, completedAt *time.Time) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO sprints (board_id, name, state, start_at, end_at, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (board_id, name) DO UPDATE SET
			state = EXCLUDED.state, start_at = EXCLUDED.start_at,
			end_at = EXCLUDED.end_at, completed_at = EXCLUDED.completed_at
		RETURNING id`, boardID, name, state, startAt, endAt, completedAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("import sprint: %w", err)
	}
	return id, nil
}

type ImportIssueRow struct {
	Number      int64
	JiraID      string
	JiraKey     string
	Type        string
	Summary     string
	Description string
	StatusID    string
	Priority    string
	AssigneeID  *string
	ReporterID  string
	Labels      []string
	StoryPoints *float64
	OriginalEstimateSeconds  *int64
	RemainingEstimateSeconds *int64
	SprintID    *string
	StartDate   *time.Time
	DueDate     *time.Time
	CreatedAt   *time.Time
	UpdatedAt   *time.Time
	DescriptionDoc []byte
	ResolvedAt  *time.Time
	Rank        string
}

// ImportUpsertIssue inserts or updates by (project, number), preserving the
// issue key. Rank and created_at are only set on first insert.
func (s *Store) ImportUpsertIssue(ctx context.Context, projectID string, row ImportIssueRow) (string, bool, error) {
	var resolution *string
	if row.ResolvedAt != nil {
		done := "done"
		resolution = &done
	}
	createdAt := time.Now().UTC()
	if row.CreatedAt != nil {
		createdAt = *row.CreatedAt
	}
	var id string
	var inserted bool
	err := s.pool.QueryRow(ctx, `
		INSERT INTO issues (project_id, number, type, summary, description, status_id, priority,
			assignee_id, reporter_id, story_points, sprint_id, due_date, resolution, resolved_at,
			rank, created_at, jira_id, jira_key, updated_at, description_doc,
			original_estimate_seconds, remaining_estimate_seconds, start_date)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
			COALESCE($19, now()), $20, $21, $22, $23)
		ON CONFLICT (project_id, number) DO UPDATE SET
			type = EXCLUDED.type, summary = EXCLUDED.summary, description = EXCLUDED.description,
			status_id = EXCLUDED.status_id, priority = EXCLUDED.priority,
			assignee_id = EXCLUDED.assignee_id, story_points = EXCLUDED.story_points,
			sprint_id = EXCLUDED.sprint_id, due_date = EXCLUDED.due_date,
			resolution = EXCLUDED.resolution, resolved_at = EXCLUDED.resolved_at,
			jira_id = EXCLUDED.jira_id, jira_key = EXCLUDED.jira_key, updated_at = EXCLUDED.updated_at,
			description_doc = EXCLUDED.description_doc,
			original_estimate_seconds = EXCLUDED.original_estimate_seconds,
			remaining_estimate_seconds = EXCLUDED.remaining_estimate_seconds,
			start_date = EXCLUDED.start_date
		RETURNING id, (xmax = 0)`,
		projectID, row.Number, row.Type, row.Summary, row.Description, row.StatusID, row.Priority,
		row.AssigneeID, row.ReporterID, row.StoryPoints, row.SprintID, row.DueDate, resolution,
		row.ResolvedAt, row.Rank, createdAt, row.JiraID, row.JiraKey, row.UpdatedAt, row.DescriptionDoc,
		row.OriginalEstimateSeconds, row.RemainingEstimateSeconds, row.StartDate).Scan(&id, &inserted)
	if err != nil {
		return "", false, fmt.Errorf("import issue %s: %w", row.JiraKey, err)
	}
	if len(row.Labels) > 0 {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return "", false, err
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `DELETE FROM issue_labels WHERE issue_id = $1`, id); err != nil {
			return "", false, err
		}
		if err := setLabelsTx(ctx, tx, projectID, id, row.Labels); err != nil {
			return "", false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", false, err
		}
	}
	return id, inserted, nil
}

// ImportBumpSeq guarantees future issue numbers don't collide with imports.
func (s *Store) ImportBumpSeq(ctx context.Context, projectID string, maxNumber int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE projects SET issue_seq = GREATEST(issue_seq, $2) WHERE id = $1`, projectID, maxNumber)
	return err
}

func (s *Store) ImportSetParent(ctx context.Context, issueID, parentID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE issues SET parent_id = $2 WHERE id = $1`, issueID, parentID)
	return err
}

// MaxRank returns the highest rank in a project ("" when empty).
func (s *Store) MaxRank(ctx context.Context, projectID string) (string, error) {
	var r *string
	if err := s.pool.QueryRow(ctx, `SELECT max(rank) FROM issues WHERE project_id = $1`, projectID).Scan(&r); err != nil {
		return "", err
	}
	if r == nil {
		return "", nil
	}
	return *r, nil
}

func (s *Store) ImportUpsertComment(ctx context.Context, issueID, authorID, body string, bodyDoc []byte, createdAt time.Time, jiraID string) (bool, error) {
	var inserted bool
	err := s.pool.QueryRow(ctx, `
		INSERT INTO comments (issue_id, author_id, body, body_doc, created_at, jira_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (jira_id) WHERE jira_id IS NOT NULL DO UPDATE SET body = EXCLUDED.body, body_doc = EXCLUDED.body_doc
		RETURNING (xmax = 0)`, issueID, authorID, body, bodyDoc, createdAt, jiraID).Scan(&inserted)
	if err != nil {
		return false, fmt.Errorf("import comment: %w", err)
	}
	return inserted, nil
}

// AttachmentExistsByJiraID lets the importer skip already-downloaded binaries.
func (s *Store) AttachmentExistsByJiraID(ctx context.Context, jiraID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM attachments WHERE jira_id = $1)`, jiraID).Scan(&exists)
	return exists, err
}

func (s *Store) ImportInsertAttachment(ctx context.Context, issueID, uploaderID, filename, mime string, size int64, storageKey, jiraID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO attachments (issue_id, uploader_id, filename, mime, size_bytes, storage_key, jira_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (jira_id) WHERE jira_id IS NOT NULL DO NOTHING`,
		issueID, uploaderID, filename, mime, size, storageKey, jiraID)
	if err != nil {
		return fmt.Errorf("import attachment: %w", err)
	}
	return nil
}

// IssueIDsByNumber maps issue numbers to ids for the parent-linking pass.
func (s *Store) IssueIDsByNumber(ctx context.Context, projectID string) (map[int64]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT number, id FROM issues WHERE project_id = $1`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]string{}
	for rows.Next() {
		var n int64
		var id string
		if err := rows.Scan(&n, &id); err != nil {
			return nil, err
		}
		out[n] = id
	}
	return out, rows.Err()
}

// ExportIssues returns every issue of a project with comments, for CSV export.
func (s *Store) ExportIssues(ctx context.Context, projectID string) ([]Issue, map[string][]Comment, error) {
	issues, _, err := s.ListIssues(ctx, projectID, IssueFilter{MaxResults: 10000})
	if err != nil {
		return nil, nil, err
	}
	comments := map[string][]Comment{}
	crows, err := s.pool.Query(ctx, `
		SELECT c.issue_id, c.id, c.body, c.edited_at, c.created_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM comments c JOIN users u ON u.id = c.author_id
		WHERE c.issue_id IN (SELECT id FROM issues WHERE project_id = $1)
		ORDER BY c.created_at`, projectID)
	if err != nil {
		return nil, nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var issueID string
		var c Comment
		if err := crows.Scan(&issueID, &c.ID, &c.Body, &c.EditedAt, &c.CreatedAt,
			&c.Author.ID, &c.Author.Email, &c.Author.DisplayName, &c.Author.AvatarURL,
			&c.Author.IsActive, &c.Author.CreatedAt); err != nil {
			return nil, nil, err
		}
		comments[issueID] = append(comments[issueID], c)
	}
	return issues, comments, crows.Err()
}

// AllActiveEmails supports dry-run user matching previews.
func (s *Store) AllActiveEmails(ctx context.Context) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `SELECT lower(email::text) FROM users WHERE is_active`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			return nil, err
		}
		out[e] = true
	}
	return out, rows.Err()
}

// ---- import fidelity (rich text, links, versions, worklogs, history…) ----

// ImportUpsertWorklog is idempotent on the Jira worklog id.
func (s *Store) ImportUpsertWorklog(ctx context.Context, issueID, authorID string, seconds int64, startedAt time.Time, comment, jiraID string) (bool, error) {
	var inserted bool
	err := s.pool.QueryRow(ctx, `
		INSERT INTO worklogs (issue_id, author_id, seconds, started_at, comment, jira_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (jira_id) WHERE jira_id IS NOT NULL DO UPDATE SET
			seconds = EXCLUDED.seconds, started_at = EXCLUDED.started_at, comment = EXCLUDED.comment
		RETURNING (xmax = 0)`, issueID, authorID, seconds, startedAt, comment, jiraID).Scan(&inserted)
	if err != nil {
		return false, fmt.Errorf("import worklog: %w", err)
	}
	return inserted, nil
}

// ImportUpsertVersion finds or creates a release by name.
func (s *Store) ImportUpsertVersion(ctx context.Context, projectID, name string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO versions (project_id, name) VALUES ($1, $2)
		ON CONFLICT (project_id, name) DO UPDATE SET updated_at = versions.updated_at
		RETURNING id`, projectID, name).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("import version: %w", err)
	}
	return id, nil
}

func (s *Store) ImportAddIssueFixVersion(ctx context.Context, issueID, versionID string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO issue_fix_versions (issue_id, version_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		issueID, versionID)
	return err
}

// ImportUpsertComponent finds or creates a component and links the issue.
func (s *Store) ImportUpsertComponent(ctx context.Context, projectID, issueID, name string) error {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO components (project_id, name) VALUES ($1, $2)
		ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id`, projectID, name).Scan(&id)
	if err != nil {
		return fmt.Errorf("import component: %w", err)
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO issue_components (issue_id, component_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		issueID, id)
	return err
}

// ImportInsertEvent writes one imported changelog row with its real time.
func (s *Store) ImportInsertEvent(ctx context.Context, issueID, actorID, field string, oldV, newV any, createdAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO issue_events (issue_id, actor_id, field, old_value, new_value, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		issueID, actorID, field, jsonVal(oldV), jsonVal(newV), createdAt)
	return err
}

// ImportAddWatcher adds a watcher only when the account can actually log in —
// placeholders would just accumulate dead notifications.
func (s *Store) ImportAddWatcher(ctx context.Context, issueID, userID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO watchers (issue_id, user_id)
		SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2 AND is_active)
		ON CONFLICT DO NOTHING`, issueID, userID)
	return err
}

// ImportEnsureCustomField finds the imported space's custom field by name
// (falling back to a same-named global one) or creates it scoped to the
// space — Jira scopes fields per project, and global defs would show empty
// inputs on every space's Details panel.
func (s *Store) ImportEnsureCustomField(ctx context.Context, projectID, name, ftype string) (string, error) {
	var id string
	var scope *string
	err := s.pool.QueryRow(ctx, `
		SELECT id, project_id FROM custom_fields
		WHERE lower(name) = lower($1) AND (project_id = $2 OR project_id IS NULL)
		ORDER BY project_id NULLS LAST LIMIT 1`, name, projectID).Scan(&id, &scope)
	if err == nil {
		if scope == nil {
			// Repair earlier imports that created these globally: a global
			// def shows empty inputs on every space's Details panel.
			_, _ = s.pool.Exec(ctx,
				`UPDATE custom_fields SET project_id = $2 WHERE id = $1 AND project_id IS NULL`, id, projectID)
		}
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	f, err := s.CreateCustomField(ctx, &projectID, name, ftype, []string{})
	if err != nil {
		if errors.Is(err, ErrFieldTaken) {
			err2 := s.pool.QueryRow(ctx,
				`SELECT id FROM custom_fields WHERE lower(name) = lower($1) LIMIT 1`, name).Scan(&id)
			return id, err2
		}
		return "", err
	}
	return f.ID, nil
}

// ImportSetFieldValue stores one custom value, growing select options.
func (s *Store) ImportSetFieldValue(ctx context.Context, issueID, fieldID, ftype, value string) error {
	if ftype == "select" {
		_, err := s.pool.Exec(ctx, `
			UPDATE custom_fields SET options = options || to_jsonb($2::text)
			WHERE id = $1 AND NOT options ? $2`, fieldID, value)
		if err != nil {
			return fmt.Errorf("grow options: %w", err)
		}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO issue_field_values (issue_id, field_id, value)
		VALUES ($1, $2, to_jsonb($3::text))
		ON CONFLICT (issue_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
		issueID, fieldID, value)
	if err != nil {
		return fmt.Errorf("set field value: %w", err)
	}
	return nil
}
