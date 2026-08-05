package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage 22: time tracking ----

type Worklog struct {
	ID        string    `json:"id"`
	IssueID   string    `json:"-"`
	Author    User      `json:"author"`
	Seconds   int64     `json:"seconds"`
	StartedAt time.Time `json:"startedAt"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const worklogSelect = `
SELECT w.id, w.issue_id, w.seconds, w.started_at, w.comment, w.created_at, w.updated_at,
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM worklogs w JOIN users u ON u.id = w.author_id
`

func scanWorklog(row pgx.Row) (Worklog, error) {
	var wl Worklog
	err := row.Scan(&wl.ID, &wl.IssueID, &wl.Seconds, &wl.StartedAt, &wl.Comment, &wl.CreatedAt, &wl.UpdatedAt,
		&wl.Author.ID, &wl.Author.Email, &wl.Author.DisplayName, &wl.Author.AvatarURL,
		&wl.Author.IsActive, &wl.Author.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Worklog{}, ErrNotFound
	}
	return wl, err
}

func (s *Store) ListWorklogs(ctx context.Context, issueID string) ([]Worklog, error) {
	rows, err := s.pool.Query(ctx, worklogSelect+` WHERE w.issue_id = $1 ORDER BY w.started_at DESC`, issueID)
	if err != nil {
		return nil, fmt.Errorf("list worklogs: %w", err)
	}
	defer rows.Close()
	out := []Worklog{}
	for rows.Next() {
		wl, err := scanWorklog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, wl)
	}
	return out, rows.Err()
}

// AddWorklog logs work; adjust follows Jira's semantics:
//   - "auto": remaining = max(0, remaining - seconds); on the first log with
//     no remaining set, it seeds from the original estimate first.
//   - "leave": remaining untouched.
//   - "set": remaining = *newRemaining.
func (s *Store) AddWorklog(ctx context.Context, issueID, authorID string, seconds int64, startedAt time.Time, comment, adjust string, newRemaining *int64) (Worklog, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Worklog{}, fmt.Errorf("worklog tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO worklogs (issue_id, author_id, seconds, started_at, comment)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		issueID, authorID, seconds, startedAt, comment).Scan(&id); err != nil {
		return Worklog{}, fmt.Errorf("add worklog: %w", err)
	}

	switch adjust {
	case "set":
		if newRemaining != nil {
			if _, err := tx.Exec(ctx, `UPDATE issues SET remaining_estimate_seconds = $2 WHERE id = $1`, issueID, *newRemaining); err != nil {
				return Worklog{}, fmt.Errorf("set remaining: %w", err)
			}
		}
	case "leave":
		// nothing
	default: // auto
		if _, err := tx.Exec(ctx, `
			UPDATE issues SET remaining_estimate_seconds =
				GREATEST(0, COALESCE(remaining_estimate_seconds, original_estimate_seconds, 0) - $2)
			WHERE id = $1 AND COALESCE(remaining_estimate_seconds, original_estimate_seconds) IS NOT NULL`,
			issueID, seconds); err != nil {
			return Worklog{}, fmt.Errorf("adjust remaining: %w", err)
		}
	}

	wl, err := scanWorklog(tx.QueryRow(ctx, worklogSelect+` WHERE w.id = $1`, id))
	if err != nil {
		return Worklog{}, err
	}
	return wl, tx.Commit(ctx)
}

// UpdateWorklog edits the author's own entry.
func (s *Store) UpdateWorklog(ctx context.Context, id, authorID string, seconds int64, startedAt time.Time, comment string) (Worklog, error) {
	ct, err := s.pool.Exec(ctx, `
		UPDATE worklogs SET seconds = $3, started_at = $4, comment = $5, updated_at = now()
		WHERE id = $1 AND author_id = $2`, id, authorID, seconds, startedAt, comment)
	if err != nil {
		return Worklog{}, fmt.Errorf("update worklog: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return Worklog{}, ErrNotFound
	}
	return scanWorklog(s.pool.QueryRow(ctx, worklogSelect+` WHERE w.id = $1`, id))
}

// DeleteWorklog removes the author's own entry (admins may delete any).
func (s *Store) DeleteWorklog(ctx context.Context, id, userID string, isAdmin bool) error {
	q := `DELETE FROM worklogs WHERE id = $1 AND author_id = $2`
	args := []any{id, userID}
	if isAdmin {
		q = `DELETE FROM worklogs WHERE id = $1`
		args = []any{id}
	}
	ct, err := s.pool.Exec(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("delete worklog: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetIssueEstimates updates either estimate (nil pointers leave unchanged;
// pointer-to-nil isn't expressible here, so clearing passes set=true + nil value).
func (s *Store) SetIssueEstimates(ctx context.Context, issueID string, setOriginal bool, original *int64, setRemaining bool, remaining *int64) error {
	if !setOriginal && !setRemaining {
		return nil
	}
	q := `UPDATE issues SET `
	args := []any{issueID}
	sets := []string{}
	if setOriginal {
		args = append(args, original)
		sets = append(sets, fmt.Sprintf("original_estimate_seconds = $%d", len(args)))
	}
	if setRemaining {
		args = append(args, remaining)
		sets = append(sets, fmt.Sprintf("remaining_estimate_seconds = $%d", len(args)))
	}
	q += sets[0]
	if len(sets) > 1 {
		q += ", " + sets[1]
	}
	q += ` WHERE id = $1`
	_, err := s.pool.Exec(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("set estimates: %w", err)
	}
	return nil
}
