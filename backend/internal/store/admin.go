package store

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrInviteExpired = errors.New("invite expired or already used")

func (s *Store) IsAdmin(ctx context.Context, userID string) (bool, error) {
	var isAdmin bool
	err := s.pool.QueryRow(ctx, `SELECT is_admin FROM users WHERE id = $1`, userID).Scan(&isAdmin)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return isAdmin, err
}

// AdminUser is the user-management row (includes flags User deliberately omits).
type AdminUser struct {
	User
	IsAdmin  bool   `json:"isAdmin"`
	Imported bool   `json:"imported"` // came from a Jira import (placeholder or linked)
	JobTitle string `json:"jobTitle"`
}

// ListAllUsers returns every account, active or not, for the admin screen.
func (s *Store) ListAllUsers(ctx context.Context, query string) ([]AdminUser, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, email, display_name, avatar_url, is_active, created_at,
		       is_admin, (jira_account_id IS NOT NULL OR email LIKE '%@imported.invalid'), job_title
		FROM users
		WHERE $1 = '' OR display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
		ORDER BY is_active DESC, display_name`, query)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	users := []AdminUser{}
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.IsActive, &u.CreatedAt,
			&u.IsAdmin, &u.Imported, &u.JobTitle); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Store) SetUserActive(ctx context.Context, userID string, active bool) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1`, userID, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetUserAdmin(ctx context.Context, userID string, isAdmin bool) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET is_admin = $2, updated_at = now() WHERE id = $1`, userID, isAdmin)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- invites ----

type Invite struct {
	ID         string     `json:"id"`
	Email      string     `json:"email"`
	UserID     *string    `json:"userId"` // claiming an existing account
	Token      string     `json:"-"`
	InvitedBy  User       `json:"invitedBy"`
	CreatedAt  time.Time  `json:"createdAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	AcceptedAt *time.Time `json:"acceptedAt"`
}

func (s *Store) CreateInvite(ctx context.Context, email string, userID *string, invitedBy string) (Invite, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return Invite{}, "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO invites (email, user_id, token, invited_by, expires_at)
		VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING id`,
		email, userID, token, invitedBy).Scan(&id)
	if err != nil {
		return Invite{}, "", fmt.Errorf("create invite: %w", err)
	}
	invite, err := s.getInvite(ctx, `i.id = $1`, id)
	return invite, token, err
}

func (s *Store) getInvite(ctx context.Context, where string, arg any) (Invite, error) {
	var inv Invite
	err := s.pool.QueryRow(ctx, `
		SELECT i.id, i.email, i.user_id, i.token, i.created_at, i.expires_at, i.accepted_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM invites i JOIN users u ON u.id = i.invited_by
		WHERE `+where, arg).Scan(
		&inv.ID, &inv.Email, &inv.UserID, &inv.Token, &inv.CreatedAt, &inv.ExpiresAt, &inv.AcceptedAt,
		&inv.InvitedBy.ID, &inv.InvitedBy.Email, &inv.InvitedBy.DisplayName, &inv.InvitedBy.AvatarURL,
		&inv.InvitedBy.IsActive, &inv.InvitedBy.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invite{}, ErrNotFound
	}
	return inv, err
}

func (s *Store) GetInviteByToken(ctx context.Context, token string) (Invite, error) {
	inv, err := s.getInvite(ctx, `i.token = $1`, token)
	if err != nil {
		return Invite{}, err
	}
	if inv.AcceptedAt != nil || time.Now().After(inv.ExpiresAt) {
		return Invite{}, ErrInviteExpired
	}
	return inv, nil
}

func (s *Store) ListPendingInvites(ctx context.Context) ([]Invite, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, i.email, i.user_id, i.token, i.created_at, i.expires_at, i.accepted_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM invites i JOIN users u ON u.id = i.invited_by
		WHERE i.accepted_at IS NULL AND i.expires_at > now()
		ORDER BY i.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	defer rows.Close()
	invites := []Invite{}
	for rows.Next() {
		var inv Invite
		if err := rows.Scan(&inv.ID, &inv.Email, &inv.UserID, &inv.Token, &inv.CreatedAt, &inv.ExpiresAt, &inv.AcceptedAt,
			&inv.InvitedBy.ID, &inv.InvitedBy.Email, &inv.InvitedBy.DisplayName, &inv.InvitedBy.AvatarURL,
			&inv.InvitedBy.IsActive, &inv.InvitedBy.CreatedAt); err != nil {
			return nil, err
		}
		invites = append(invites, inv)
	}
	return invites, rows.Err()
}

func (s *Store) DeleteInvite(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM invites WHERE id = $1 AND accepted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AcceptInvite sets the password on the claimed account (or creates a new
// one), activates it, and marks the invite accepted — one transaction.
func (s *Store) AcceptInvite(ctx context.Context, inv Invite, displayName, passwordHash string) (User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)

	var userID string
	if inv.UserID != nil {
		userID = *inv.UserID
		query := `UPDATE users SET password_hash = $2, is_active = TRUE, updated_at = now()`
		args := []any{userID, passwordHash}
		if displayName != "" {
			query += `, display_name = $3`
			args = append(args, displayName)
		}
		if _, err := tx.Exec(ctx, query+` WHERE id = $1`, args...); err != nil {
			return User{}, fmt.Errorf("claim account: %w", err)
		}
	} else {
		if displayName == "" {
			displayName = inv.Email
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, display_name, is_active)
			VALUES ($1, $2, $3, TRUE)
			ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE
			RETURNING id`, inv.Email, passwordHash, displayName).Scan(&userID)
		if err != nil {
			return User{}, fmt.Errorf("create invited user: %w", err)
		}
	}
	if _, err := tx.Exec(ctx,
		`UPDATE invites SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL`, inv.ID); err != nil {
		return User{}, fmt.Errorf("mark invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return s.GetUserByID(ctx, userID)
}

// ---- site settings ----

func (s *Store) SiteSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM site_settings`)
	if err != nil {
		return nil, fmt.Errorf("site settings: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func (s *Store) SetSiteSetting(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO site_settings (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}

// ---- site-wide project overview ----

type AdminProject struct {
	Project
	MemberCount int    `json:"memberCount"`
	IssueCount  int    `json:"issueCount"`
	Category    string `json:"category"`
	SchemeID    string `json:"schemeId"`
}

func (s *Store) ListAllProjects(ctx context.Context) ([]AdminProject, error) {
	rows, err := s.pool.Query(ctx, projectSelect+` ORDER BY p.name`)
	if err != nil {
		return nil, fmt.Errorf("all projects: %w", err)
	}
	defer rows.Close()
	projects := []AdminProject{}
	for rows.Next() {
		var p AdminProject
		var err error
		p.Project, err = scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range projects {
		s.pool.QueryRow(ctx, `SELECT count(*) FROM project_members WHERE project_id = $1`,
			projects[i].ID).Scan(&projects[i].MemberCount)
		s.pool.QueryRow(ctx, `SELECT count(*) FROM issues WHERE project_id = $1`,
			projects[i].ID).Scan(&projects[i].IssueCount)
		projects[i].Category, _ = s.CategoryNameOf(ctx, projects[i].ID)
		s.pool.QueryRow(ctx, `SELECT permission_scheme_id FROM projects WHERE id = $1`,
			projects[i].ID).Scan(&projects[i].SchemeID)
	}
	return projects, nil
}

func (s *Store) SetProjectLead(ctx context.Context, projectKey, userID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE projects SET lead_id = $2, updated_at = now() WHERE key = $1`, projectKey, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	// The lead must be a member to see the project.
	var projectID string
	if err := s.pool.QueryRow(ctx, `SELECT id FROM projects WHERE key = $1`, projectKey).Scan(&projectID); err == nil {
		_ = s.AddMember(ctx, projectID, userID, "admin")
	}
	return nil
}

// SystemStats powers the admin System page.
func (s *Store) SystemStats(ctx context.Context) (map[string]any, error) {
	stats := map[string]any{}
	counts := map[string]string{
		"users":    `SELECT count(*) FROM users WHERE is_active`,
		"projects": `SELECT count(*) FROM projects`,
		"issues":   `SELECT count(*) FROM issues`,
		"comments": `SELECT count(*) FROM comments`,
		"sessions": `SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND last_seen_at > now() - interval '7 days'`,
	}
	for k, q := range counts {
		var n int
		if err := s.pool.QueryRow(ctx, q).Scan(&n); err != nil {
			return nil, err
		}
		stats[k] = n
	}
	rows, err := s.pool.Query(ctx, `
		SELECT j.project_key, j.source, j.status, j.created_at, u.display_name
		FROM import_jobs j JOIN users u ON u.id = j.owner_id
		ORDER BY j.created_at DESC LIMIT 10`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type jobRow struct {
		ProjectKey string    `json:"projectKey"`
		Source     string    `json:"source"`
		Status     string    `json:"status"`
		CreatedAt  time.Time `json:"createdAt"`
		Owner      string    `json:"owner"`
	}
	jobs := []jobRow{}
	for rows.Next() {
		var j jobRow
		if err := rows.Scan(&j.ProjectKey, &j.Source, &j.Status, &j.CreatedAt, &j.Owner); err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	raw, _ := json.Marshal(jobs)
	stats["importJobs"] = json.RawMessage(raw)
	return stats, rows.Err()
}
