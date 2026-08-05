package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrKeyTaken = errors.New("project key already in use")

const DefaultWorkflowID = "00000000-0000-0000-0000-000000000001"

type Project struct {
	ID                string          `json:"id"`
	Key               string          `json:"key"`
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	ProjectType       string          `json:"projectType"`
	WorkflowID        string          `json:"-"`
	Lead              User            `json:"lead"`
	AvatarURL         *string         `json:"avatarUrl"`
	DefaultAssigneeID *string         `json:"defaultAssigneeId"`
	ArchivedAt        *time.Time      `json:"archivedAt"`
	NotifyPrefs       map[string]bool `json:"notifyPrefs"`
	URL               string          `json:"url"`
	Features          map[string]bool `json:"features"`
	CategoryID        *string         `json:"categoryId"`
	CategoryName      *string         `json:"categoryName"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
}

type Member struct {
	User User   `json:"user"`
	Role string `json:"role"`
}

const projectSelect = `
SELECT p.id, p.key, p.name, p.description, p.project_type, p.workflow_id,
       p.avatar_key, p.default_assignee_id, p.archived_at, p.notify_prefs,
       p.url, p.features, p.category_id, sc.name,
       p.created_at, p.updated_at,
       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
FROM projects p
JOIN users u ON u.id = p.lead_id
LEFT JOIN space_categories sc ON sc.id = p.category_id
`

func scanProject(row pgx.Row) (Project, error) {
	var p Project
	var avatarKey *string
	err := row.Scan(
		&p.ID, &p.Key, &p.Name, &p.Description, &p.ProjectType, &p.WorkflowID,
		&avatarKey, &p.DefaultAssigneeID, &p.ArchivedAt, &p.NotifyPrefs,
		&p.URL, &p.Features, &p.CategoryID, &p.CategoryName,
		&p.CreatedAt, &p.UpdatedAt,
		&p.Lead.ID, &p.Lead.Email, &p.Lead.DisplayName, &p.Lead.AvatarURL, &p.Lead.IsActive, &p.Lead.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	if avatarKey != nil {
		u := "/api/v1/avatars/" + *avatarKey
		p.AvatarURL = &u
	}
	if p.NotifyPrefs == nil {
		p.NotifyPrefs = map[string]bool{}
	}
	if p.Features == nil {
		p.Features = map[string]bool{}
	}
	return p, err
}

// CreateProject creates the project and adds the lead as an admin member.
func (s *Store) CreateProject(ctx context.Context, key, name, description, projectType, leadID string) (Project, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Project{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Each project owns its workflow, cloned from the default template.
	workflowID, err := cloneWorkflowTx(ctx, tx, DefaultWorkflowID, key+" workflow")
	if err != nil {
		return Project{}, err
	}

	var id string
	err = tx.QueryRow(ctx,
		`INSERT INTO projects (key, name, description, project_type, lead_id, workflow_id, permission_scheme_id)
		 VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM permission_schemes WHERE is_default)) RETURNING id`,
		key, name, description, projectType, leadID, workflowID).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return Project{}, ErrKeyTaken
	}
	if err != nil {
		return Project{}, fmt.Errorf("insert project: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')`, id, leadID); err != nil {
		return Project{}, fmt.Errorf("insert lead member: %w", err)
	}
	if err := createDefaultBoardTx(ctx, tx, id, key, projectType, workflowID); err != nil {
		return Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Project{}, fmt.Errorf("commit: %w", err)
	}
	return s.GetProjectByKey(ctx, key)
}

func (s *Store) GetProjectByKey(ctx context.Context, key string) (Project, error) {
	return scanProject(s.pool.QueryRow(ctx, projectSelect+` WHERE p.key = $1`, key))
}

// ListProjects returns non-archived projects the user is a member of.
func (s *Store) ListProjects(ctx context.Context, userID string) ([]Project, error) {
	rows, err := s.pool.Query(ctx, projectSelect+`
		JOIN project_members m ON m.project_id = p.id
		WHERE m.user_id = $1 AND p.archived_at IS NULL
		ORDER BY p.name`, userID)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Store) UpdateProject(ctx context.Context, key, name, description string) (Project, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE projects SET name = $2, description = $3, updated_at = now() WHERE key = $1`,
		key, name, description)
	if err != nil {
		return Project{}, fmt.Errorf("update project: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Project{}, ErrNotFound
	}
	return s.GetProjectByKey(ctx, key)
}

// DeleteProject removes the space, its orphaned workflow, and returns the
// storage keys behind its issue attachments and avatar for blob cleanup.
func (s *Store) DeleteProject(ctx context.Context, key string) ([]string, error) {
	blobKeys, err := s.attachmentStorageKeys(ctx,
		`JOIN issues i ON i.id = a.issue_id JOIN projects p ON p.id = i.project_id WHERE p.key = $1`, key)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var workflowID string
	var avatarKey *string
	err = tx.QueryRow(ctx,
		`DELETE FROM projects WHERE key = $1 RETURNING workflow_id, avatar_key`, key).Scan(&workflowID, &avatarKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("delete project: %w", err)
	}
	if avatarKey != nil && *avatarKey != "" {
		blobKeys = append(blobKeys, *avatarKey)
	}
	// The space's private workflow is orphaned now — drop it so the admin
	// Workflows directory doesn't fill with dead per-space workflows.
	if _, err := tx.Exec(ctx, `
		DELETE FROM workflows WHERE id = $1 AND is_default = FALSE
		  AND NOT EXISTS (SELECT 1 FROM projects WHERE workflow_id = $1)`, workflowID); err != nil {
		return nil, fmt.Errorf("drop orphaned workflow: %w", err)
	}
	return blobKeys, tx.Commit(ctx)
}

// MemberRole returns the user's role in the project, or ErrNotFound.
func (s *Store) MemberRole(ctx context.Context, projectID, userID string) (string, error) {
	var role string
	err := s.pool.QueryRow(ctx,
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`, projectID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}

func (s *Store) ListMembers(ctx context.Context, projectID string) ([]Member, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at, m.role
		FROM project_members m JOIN users u ON u.id = m.user_id
		WHERE m.project_id = $1 ORDER BY u.display_name`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	defer rows.Close()
	members := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.User.ID, &m.User.Email, &m.User.DisplayName, &m.User.AvatarURL,
			&m.User.IsActive, &m.User.CreatedAt, &m.Role); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

func (s *Store) AddMember(ctx context.Context, projectID, userID, role string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
		ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
		projectID, userID, role)
	if err != nil {
		return fmt.Errorf("add member: %w", err)
	}
	return nil
}

// SearchUsers finds active users by name or email prefix for assignee pickers.
func (s *Store) SearchUsers(ctx context.Context, query string, limit int) ([]User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+userCols+` FROM users
		WHERE is_active AND (display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
		ORDER BY display_name LIMIT $2`, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search users: %w", err)
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}
