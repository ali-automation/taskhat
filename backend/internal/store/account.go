package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Profile is the full account view of a user (User + Stage 7 fields).
type Profile struct {
	User
	PublicName   string  `json:"publicName"`
	JobTitle     string  `json:"jobTitle"`
	Department   string  `json:"department"`
	Organization string  `json:"organization"`
	Location     string  `json:"location"`
	Timezone     string  `json:"timezone"`
	Theme        string  `json:"theme"`
	Language     string  `json:"language"`
	LandingPage  string  `json:"landingPage"`
	HeaderURL    *string `json:"headerUrl"`
}

const profileCols = userCols + `, public_name, job_title, department, organization, location, timezone, theme, language, landing_page, header_key`

func scanProfile(row pgx.Row) (Profile, error) {
	var p Profile
	var headerKey *string
	err := row.Scan(&p.ID, &p.Email, &p.DisplayName, &p.AvatarURL, &p.IsActive, &p.IsDemo, &p.CreatedAt,
		&p.PublicName, &p.JobTitle, &p.Department, &p.Organization, &p.Location,
		&p.Timezone, &p.Theme, &p.Language, &p.LandingPage, &headerKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if headerKey != nil {
		u := "/api/v1/avatars/" + *headerKey
		p.HeaderURL = &u
	}
	return p, err
}

func (s *Store) GetProfile(ctx context.Context, userID string) (Profile, error) {
	return scanProfile(s.pool.QueryRow(ctx,
		`SELECT `+profileCols+` FROM users WHERE id = $1`, userID))
}

type ProfileUpdate struct {
	DisplayName  string `json:"displayName"`
	PublicName   string `json:"publicName"`
	JobTitle     string `json:"jobTitle"`
	Department   string `json:"department"`
	Organization string `json:"organization"`
	Location     string `json:"location"`
}

func (s *Store) UpdateProfile(ctx context.Context, userID string, u ProfileUpdate) (Profile, error) {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET display_name = $2, public_name = $3, job_title = $4,
			department = $5, organization = $6, location = $7, updated_at = now()
		WHERE id = $1`,
		userID, u.DisplayName, u.PublicName, u.JobTitle, u.Department, u.Organization, u.Location)
	if err != nil {
		return Profile{}, fmt.Errorf("update profile: %w", err)
	}
	return s.GetProfile(ctx, userID)
}

type Preferences struct {
	Timezone    string `json:"timezone"`
	Theme       string `json:"theme"`
	Language    string `json:"language"`
	LandingPage string `json:"landingPage"`
}

func (s *Store) UpdatePreferences(ctx context.Context, userID string, p Preferences) (Profile, error) {
	// Empty strings mean "leave unchanged" so partial preference forms
	// (Account page vs settings/general) don't clobber each other.
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET
			timezone     = COALESCE(NULLIF($2, ''), timezone),
			theme        = COALESCE(NULLIF($3, ''), theme),
			language     = COALESCE(NULLIF($4, ''), language),
			landing_page = COALESCE(NULLIF($5, ''), landing_page),
			updated_at   = now()
		WHERE id = $1`,
		userID, p.Timezone, p.Theme, p.Language, p.LandingPage)
	if err != nil {
		return Profile{}, fmt.Errorf("update preferences: %w", err)
	}
	return s.GetProfile(ctx, userID)
}

// ---- per-user notification preferences (Stage 10) ----

// KindPref holds a user's channel switches for one event kind; nil = on.
type KindPref struct {
	Inapp *bool `json:"inapp,omitempty"`
	Email *bool `json:"email,omitempty"`
}

// UserNotifyPrefs is the per-user notification matrix. Empty = everything on.
type UserNotifyPrefs struct {
	EmailEnabled *bool               `json:"emailEnabled,omitempty"`
	Kinds        map[string]KindPref `json:"kinds,omitempty"`
}

// InappAllowed reports whether the user wants in-app notifications for kind.
func (p UserNotifyPrefs) InappAllowed(kind string) bool {
	if k, ok := p.Kinds[kind]; ok && k.Inapp != nil {
		return *k.Inapp
	}
	return true
}

// EmailAllowed reports whether the user wants email for kind (kind switch AND
// the global email switch).
func (p UserNotifyPrefs) EmailAllowed(kind string) bool {
	if p.EmailEnabled != nil && !*p.EmailEnabled {
		return false
	}
	if k, ok := p.Kinds[kind]; ok && k.Email != nil {
		return *k.Email
	}
	return true
}

func (s *Store) GetUserNotifyPrefs(ctx context.Context, userID string) (UserNotifyPrefs, error) {
	var prefs UserNotifyPrefs
	err := s.pool.QueryRow(ctx,
		`SELECT notify_prefs FROM users WHERE id = $1`, userID).Scan(&prefs)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserNotifyPrefs{}, ErrNotFound
	}
	return prefs, err
}

func (s *Store) UpdateUserNotifyPrefs(ctx context.Context, userID string, prefs UserNotifyPrefs) error {
	raw, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`UPDATE users SET notify_prefs = $2, updated_at = now() WHERE id = $1`, userID, raw)
	return err
}

func (s *Store) UpdateEmail(ctx context.Context, userID, email string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users SET email = $2, updated_at = now() WHERE id = $1`, userID, email)
	if isUniqueViolation(err) {
		return ErrEmailTaken
	}
	return err
}

func (s *Store) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, userID, passwordHash)
	return err
}

// GetPasswordHash supports current-password confirmation flows.
func (s *Store) GetPasswordHash(ctx context.Context, userID string) (string, error) {
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return hash, err
}

// SetUserImage stores an avatar or header blob key and returns the old key
// (for cleanup). kind is "avatar" or "header".
func (s *Store) SetUserImage(ctx context.Context, userID, kind string, key *string) (oldKey *string, err error) {
	col := "avatar_key"
	if kind == "header" {
		col = "header_key"
	}
	query := `UPDATE users SET ` + col + ` = $2, updated_at = now()`
	if kind == "avatar" {
		query += `, avatar_url = CASE WHEN $2::text IS NULL THEN NULL ELSE '/api/v1/avatars/' || $2 END`
	}
	query += ` WHERE id = $1 RETURNING (SELECT ` + col + ` FROM users WHERE id = $1)`
	err = s.pool.QueryRow(ctx, query, userID, key).Scan(&oldKey)
	if err != nil {
		return nil, fmt.Errorf("set %s: %w", kind, err)
	}
	return oldKey, nil
}

// ImageKeyExists checks an avatar/header key exists (public image route).
// Covers user avatars/headers and space avatars.
func (s *Store) ImageKeyExists(ctx context.Context, key string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM users WHERE avatar_key = $1 OR header_key = $1)
		    OR EXISTS (SELECT 1 FROM projects WHERE avatar_key = $1)`, key).Scan(&exists)
	return exists, err
}

// ---- sessions ----

type Session struct {
	ID         string     `json:"id"`
	IP         string     `json:"ip"`
	UserAgent  string     `json:"userAgent"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastSeenAt time.Time  `json:"lastSeenAt"`
	Current    bool       `json:"current"`
	RevokedAt  *time.Time `json:"-"`
}

func (s *Store) CreateSession(ctx context.Context, userID, ip, userAgent string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`INSERT INTO sessions (user_id, ip, user_agent) VALUES ($1, $2, $3) RETURNING id`,
		userID, ip, userAgent).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	return id, nil
}

func (s *Store) TouchSession(ctx context.Context, sessionID string) {
	_, _ = s.pool.Exec(ctx, `UPDATE sessions SET last_seen_at = now() WHERE id = $1`, sessionID)
}

func (s *Store) RevokeSessionRow(ctx context.Context, userID, sessionID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
		sessionID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListActiveSessions returns non-revoked sessions seen in the last 30 days.
func (s *Store) ListActiveSessions(ctx context.Context, userID string) ([]Session, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, ip, user_agent, created_at, last_seen_at
		FROM sessions
		WHERE user_id = $1 AND revoked_at IS NULL AND last_seen_at > now() - interval '30 days'
		ORDER BY last_seen_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()
	sessions := []Session{}
	for rows.Next() {
		var sess Session
		if err := rows.Scan(&sess.ID, &sess.IP, &sess.UserAgent, &sess.CreatedAt, &sess.LastSeenAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, sess)
	}
	return sessions, rows.Err()
}

// ActiveSessionIDs supports revoke-all-others.
func (s *Store) ActiveSessionIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, userID)
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

// SharedProjects lists projects where both users are members.
func (s *Store) SharedProjects(ctx context.Context, viewerID, targetID string) ([]Project, error) {
	rows, err := s.pool.Query(ctx, projectSelect+`
		JOIN project_members m1 ON m1.project_id = p.id AND m1.user_id = $1
		JOIN project_members m2 ON m2.project_id = p.id AND m2.user_id = $2
		ORDER BY p.name`, viewerID, targetID)
	if err != nil {
		return nil, fmt.Errorf("shared projects: %w", err)
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
