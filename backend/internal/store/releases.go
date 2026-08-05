package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage 21: Releases (fix versions) ----

type Version struct {
	ID          string     `json:"id"`
	ProjectID   string     `json:"-"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	StartDate   *time.Time `json:"startDate"`
	ReleaseDate *time.Time `json:"releaseDate"`
	Status      string     `json:"status"` // unreleased | released | archived
	ReleasedAt  *time.Time `json:"releasedAt"`
	Done        int        `json:"done"`  // resolved work items
	Total       int        `json:"total"` // all work items on the version
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// VersionRef rides on issue payloads.
type VersionRef struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

const versionSelect = `
SELECT v.id, v.project_id, v.name, v.description, v.start_date, v.release_date,
       v.status, v.released_at, v.created_at, v.updated_at,
       COALESCE((SELECT count(*) FROM issue_fix_versions fv
                 JOIN issues i ON i.id = fv.issue_id
                 WHERE fv.version_id = v.id AND i.resolution IS NOT NULL), 0),
       COALESCE((SELECT count(*) FROM issue_fix_versions fv WHERE fv.version_id = v.id), 0)
FROM versions v
`

func scanVersion(row pgx.Row) (Version, error) {
	var v Version
	err := row.Scan(&v.ID, &v.ProjectID, &v.Name, &v.Description, &v.StartDate, &v.ReleaseDate,
		&v.Status, &v.ReleasedAt, &v.CreatedAt, &v.UpdatedAt, &v.Done, &v.Total)
	return v, err
}

func (s *Store) ListVersions(ctx context.Context, projectID string) ([]Version, error) {
	rows, err := s.pool.Query(ctx, versionSelect+`
		WHERE v.project_id = $1
		ORDER BY CASE v.status WHEN 'unreleased' THEN 0 WHEN 'released' THEN 1 ELSE 2 END,
		         v.release_date NULLS LAST, v.created_at DESC`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		v, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) GetVersion(ctx context.Context, id string) (Version, error) {
	v, err := scanVersion(s.pool.QueryRow(ctx, versionSelect+` WHERE v.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrNotFound
	}
	if err != nil {
		return Version{}, fmt.Errorf("get version: %w", err)
	}
	return v, nil
}

var ErrVersionExists = errors.New("a version with that name already exists")

func (s *Store) CreateVersion(ctx context.Context, projectID, name, description string, start, release *time.Time) (Version, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO versions (project_id, name, description, start_date, release_date)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (project_id, name) DO NOTHING
		RETURNING id`, projectID, name, description, start, release).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrVersionExists
	}
	if err != nil {
		return Version{}, fmt.Errorf("create version: %w", err)
	}
	return s.GetVersion(ctx, id)
}

func (s *Store) UpdateVersion(ctx context.Context, id, name, description string, start, release *time.Time) (Version, error) {
	ct, err := s.pool.Exec(ctx, `
		UPDATE versions SET name = $2, description = $3, start_date = $4, release_date = $5, updated_at = now()
		WHERE id = $1`, id, name, description, start, release)
	if err != nil {
		if isUniqueViolation(err) {
			return Version{}, ErrVersionExists
		}
		return Version{}, fmt.Errorf("update version: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return Version{}, ErrNotFound
	}
	return s.GetVersion(ctx, id)
}

// SetVersionStatus releases/archives/reopens a version. When releasing with
// moveOpenTo set, unresolved work items on the version move to that version
// (Jira's release dialog).
func (s *Store) SetVersionStatus(ctx context.Context, id, status string, moveOpenTo *string) (Version, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Version{}, fmt.Errorf("version tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if status == "released" && moveOpenTo != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO issue_fix_versions (issue_id, version_id)
			SELECT fv.issue_id, $2 FROM issue_fix_versions fv
			JOIN issues i ON i.id = fv.issue_id
			WHERE fv.version_id = $1 AND i.resolution IS NULL
			ON CONFLICT DO NOTHING`, id, *moveOpenTo); err != nil {
			return Version{}, fmt.Errorf("move open items: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			DELETE FROM issue_fix_versions fv USING issues i
			WHERE fv.version_id = $1 AND i.id = fv.issue_id AND i.resolution IS NULL`, id); err != nil {
			return Version{}, fmt.Errorf("clear open items: %w", err)
		}
	}

	ct, err := tx.Exec(ctx, `
		UPDATE versions SET status = $2, updated_at = now(),
		       released_at = CASE WHEN $2 = 'released' THEN now() ELSE released_at END
		WHERE id = $1`, id, status)
	if err != nil {
		return Version{}, fmt.Errorf("set version status: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return Version{}, ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return Version{}, err
	}
	return s.GetVersion(ctx, id)
}

func (s *Store) DeleteVersion(ctx context.Context, id string) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM versions WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete version: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// VersionIssues lists the work items on a version, done last like Jira.
func (s *Store) VersionIssues(ctx context.Context, versionID string) ([]Issue, error) {
	rows, err := s.pool.Query(ctx, issueSelect+`
		JOIN issue_fix_versions fv ON fv.issue_id = i.id
		WHERE fv.version_id = $1
		ORDER BY (i.resolution IS NOT NULL), i.rank`, versionID)
	if err != nil {
		return nil, fmt.Errorf("version issues: %w", err)
	}
	defer rows.Close()
	out := []Issue{}
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// SetIssueFixVersions replaces an issue's fix versions; returns old and new
// name lists for the changelog.
func (s *Store) SetIssueFixVersions(ctx context.Context, issueID string, versionIDs []string) (old, now []string, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("fix versions tx: %w", err)
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT v.name FROM issue_fix_versions fv JOIN versions v ON v.id = fv.version_id
		WHERE fv.issue_id = $1 ORDER BY v.name`, issueID)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, nil, err
		}
		old = append(old, n)
	}
	rows.Close()

	if _, err := tx.Exec(ctx, `DELETE FROM issue_fix_versions WHERE issue_id = $1`, issueID); err != nil {
		return nil, nil, err
	}
	if len(versionIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO issue_fix_versions (issue_id, version_id)
			SELECT $1, v.id FROM versions v
			WHERE v.id = ANY($2) AND v.project_id = (SELECT project_id FROM issues WHERE id = $1)
			ON CONFLICT DO NOTHING`, issueID, versionIDs); err != nil {
			return nil, nil, err
		}
	}
	rows, err = tx.Query(ctx, `
		SELECT v.name FROM issue_fix_versions fv JOIN versions v ON v.id = fv.version_id
		WHERE fv.issue_id = $1 ORDER BY v.name`, issueID)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, nil, err
		}
		now = append(now, n)
	}
	rows.Close()
	return old, now, tx.Commit(ctx)
}
