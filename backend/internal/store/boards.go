package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/ali-automation/taskhat/backend/internal/rank"
)

type BoardColumn struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Position  int      `json:"position"`
	MinIssues *int     `json:"minIssues"`
	MaxIssues *int     `json:"maxIssues"`
	StatusIDs []string `json:"statusIds"`
}

type Board struct {
	ID         string        `json:"id"`
	ProjectID  string        `json:"-"`
	ProjectKey string        `json:"projectKey"`
	Name       string        `json:"name"`
	Type       string        `json:"type"`
	Columns    []BoardColumn `json:"columns"`
}

// createDefaultBoardTx makes the project's board with 1:1 status columns.
func createDefaultBoardTx(ctx context.Context, tx pgx.Tx, projectID, projectKey, projectType, workflowID string) error {
	var boardID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO boards (project_id, name, type) VALUES ($1, $2, $3) RETURNING id`,
		projectID, projectKey+" board", projectType).Scan(&boardID); err != nil {
		return fmt.Errorf("insert board: %w", err)
	}
	rows, err := tx.Query(ctx,
		`SELECT id, name, position FROM statuses WHERE workflow_id = $1 ORDER BY position`, workflowID)
	if err != nil {
		return fmt.Errorf("statuses for board: %w", err)
	}
	type st struct {
		id, name string
		pos      int
	}
	var statuses []st
	for rows.Next() {
		var s st
		if err := rows.Scan(&s.id, &s.name, &s.pos); err != nil {
			rows.Close()
			return err
		}
		statuses = append(statuses, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, s := range statuses {
		var colID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO board_columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id`,
			boardID, s.name, s.pos).Scan(&colID); err != nil {
			return fmt.Errorf("insert column: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO board_column_statuses (column_id, status_id) VALUES ($1, $2)`, colID, s.id); err != nil {
			return fmt.Errorf("map column status: %w", err)
		}
	}
	return nil
}

func (s *Store) loadColumns(ctx context.Context, boardID string) ([]BoardColumn, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.name, c.position, c.min_issues, c.max_issues,
		       COALESCE(array_agg(cs.status_id) FILTER (WHERE cs.status_id IS NOT NULL), '{}')
		FROM board_columns c
		LEFT JOIN board_column_statuses cs ON cs.column_id = c.id
		WHERE c.board_id = $1
		GROUP BY c.id
		ORDER BY c.position`, boardID)
	if err != nil {
		return nil, fmt.Errorf("board columns: %w", err)
	}
	defer rows.Close()
	cols := []BoardColumn{}
	for rows.Next() {
		var c BoardColumn
		if err := rows.Scan(&c.ID, &c.Name, &c.Position, &c.MinIssues, &c.MaxIssues, &c.StatusIDs); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

func (s *Store) ListBoards(ctx context.Context, projectID string) ([]Board, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT b.id, b.project_id, p.key, b.name, b.type
		FROM boards b JOIN projects p ON p.id = b.project_id
		WHERE b.project_id = $1 ORDER BY b.created_at`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list boards: %w", err)
	}
	defer rows.Close()
	boards := []Board{}
	for rows.Next() {
		var b Board
		if err := rows.Scan(&b.ID, &b.ProjectID, &b.ProjectKey, &b.Name, &b.Type); err != nil {
			return nil, err
		}
		boards = append(boards, b)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range boards {
		cols, err := s.loadColumns(ctx, boards[i].ID)
		if err != nil {
			return nil, err
		}
		boards[i].Columns = cols
	}
	return boards, nil
}

func (s *Store) GetBoard(ctx context.Context, boardID string) (Board, error) {
	var b Board
	err := s.pool.QueryRow(ctx, `
		SELECT b.id, b.project_id, p.key, b.name, b.type
		FROM boards b JOIN projects p ON p.id = b.project_id
		WHERE b.id = $1`, boardID).Scan(&b.ID, &b.ProjectID, &b.ProjectKey, &b.Name, &b.Type)
	if errors.Is(err, pgx.ErrNoRows) {
		return Board{}, ErrNotFound
	}
	if err != nil {
		return Board{}, fmt.Errorf("get board: %w", err)
	}
	b.Columns, err = s.loadColumns(ctx, b.ID)
	return b, err
}

type ColumnUpdate struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MinIssues *int   `json:"minIssues"`
	MaxIssues *int   `json:"maxIssues"`
}

func (s *Store) UpdateColumns(ctx context.Context, boardID string, updates []ColumnUpdate) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	for _, u := range updates {
		tag, err := tx.Exec(ctx,
			`UPDATE board_columns SET name = $2, min_issues = $3, max_issues = $4 WHERE id = $1 AND board_id = $5`,
			u.ID, u.Name, u.MinIssues, u.MaxIssues, boardID)
		if err != nil {
			return fmt.Errorf("update column: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	return tx.Commit(ctx)
}

// RankIssue re-ranks an issue relative to a reference issue in the same
// project. Exactly one of beforeID/afterID is set ("place before/after ref").
func (s *Store) RankIssue(ctx context.Context, issueID string, beforeID, afterID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var projectID string
	if err := tx.QueryRow(ctx, `SELECT project_id FROM issues WHERE id = $1 FOR UPDATE`, issueID).Scan(&projectID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("load issue: %w", err)
	}

	refID := beforeID
	if refID == "" {
		refID = afterID
	}
	var refRank string
	err = tx.QueryRow(ctx,
		`SELECT rank FROM issues WHERE id = $1 AND project_id = $2`, refID, projectID).Scan(&refRank)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("load ref issue: %w", err)
	}

	var newRank string
	if beforeID != "" {
		// Neighbor above the reference (excluding the moving issue itself).
		var prev *string
		if err := tx.QueryRow(ctx,
			`SELECT max(rank) FROM issues WHERE project_id = $1 AND rank < $2 AND id <> $3`,
			projectID, refRank, issueID).Scan(&prev); err != nil {
			return fmt.Errorf("prev rank: %w", err)
		}
		lo := ""
		if prev != nil {
			lo = *prev
		}
		newRank, err = rank.Between(lo, refRank)
	} else {
		var next *string
		if err := tx.QueryRow(ctx,
			`SELECT min(rank) FROM issues WHERE project_id = $1 AND rank > $2 AND id <> $3`,
			projectID, refRank, issueID).Scan(&next); err != nil {
			return fmt.Errorf("next rank: %w", err)
		}
		hi := ""
		if next != nil {
			hi = *next
		}
		newRank, err = rank.Between(refRank, hi)
	}
	if err != nil {
		return fmt.Errorf("compute rank: %w", err)
	}

	if _, err := tx.Exec(ctx, `UPDATE issues SET rank = $2, updated_at = now() WHERE id = $1`, issueID, newRank); err != nil {
		return fmt.Errorf("update rank: %w", err)
	}
	return tx.Commit(ctx)
}

// CreateBoard adds another board to a space (Jira: sidebar + > Create a
// board). Columns start as the workflow's category triple so any status is
// reachable, mirroring a fresh Jira board.
func (s *Store) CreateBoard(ctx context.Context, projectID, name, boardType string) (Board, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Board{}, err
	}
	defer tx.Rollback(ctx)
	var boardID, workflowID string
	if err := tx.QueryRow(ctx,
		`SELECT workflow_id FROM projects WHERE id = $1`, projectID).Scan(&workflowID); err != nil {
		return Board{}, fmt.Errorf("project workflow: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`INSERT INTO boards (project_id, name, type) VALUES ($1, $2, $3) RETURNING id`,
		projectID, name, boardType).Scan(&boardID); err != nil {
		return Board{}, fmt.Errorf("insert board: %w", err)
	}
	cols := []struct {
		name string
		cats []string
	}{
		{"To Do", []string{"todo"}},
		{"In Progress", []string{"in_progress"}},
		{"Done", []string{"done"}},
	}
	for i, c := range cols {
		var colID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO board_columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id`,
			boardID, c.name, i).Scan(&colID); err != nil {
			return Board{}, fmt.Errorf("insert column: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO board_column_statuses (column_id, status_id)
			SELECT $1, id FROM statuses WHERE workflow_id = $2 AND category = ANY($3)`,
			colID, workflowID, c.cats); err != nil {
			return Board{}, fmt.Errorf("map column statuses: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Board{}, err
	}
	return s.GetBoard(ctx, boardID)
}

// RenameBoard updates the board name (board settings > Details).
func (s *Store) RenameBoard(ctx context.Context, boardID, name string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE boards SET name = $2 WHERE id = $1`, boardID, name)
	if err != nil {
		return fmt.Errorf("rename board: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

var ErrLastBoard = errors.New("a space needs at least one board")

// DeleteBoard removes a board (never the space's last one). Sprints cascade.
func (s *Store) DeleteBoard(ctx context.Context, boardID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var projectID string
	if err := tx.QueryRow(ctx, `SELECT project_id FROM boards WHERE id = $1`, boardID).Scan(&projectID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM boards WHERE project_id = $1`, projectID).Scan(&count); err != nil {
		return err
	}
	if count <= 1 {
		return ErrLastBoard
	}
	if _, err := tx.Exec(ctx, `DELETE FROM boards WHERE id = $1`, boardID); err != nil {
		return fmt.Errorf("delete board: %w", err)
	}
	return tx.Commit(ctx)
}
