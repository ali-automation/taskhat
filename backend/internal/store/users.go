package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrEmailTaken   = errors.New("email already registered")
	uniqueViolation = "23505"
)

type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	AvatarURL   *string   `json:"avatarUrl"`
	IsActive    bool      `json:"isActive"`
	IsDemo      bool      `json:"isDemo,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

const userCols = "id, email, display_name, avatar_url, is_active, is_demo, created_at"

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.IsActive, &u.IsDemo, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// GetOrCreateDemoUser returns the read-only demo account, provisioning it on
// first use. It can never log in with a password and is never an admin.
func (s *Store) GetOrCreateDemoUser(ctx context.Context) (User, error) {
	u, err := scanUser(s.pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE is_demo AND is_active ORDER BY created_at LIMIT 1`))
	if err == nil {
		return u, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return User{}, fmt.Errorf("get demo user: %w", err)
	}
	return scanUser(s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, is_active, is_admin, is_demo)
		VALUES ('demo@taskhat.local', '!demo', 'Demo Explorer', TRUE, FALSE, TRUE)
		ON CONFLICT (email) DO UPDATE SET is_demo = TRUE, is_active = TRUE
		RETURNING `+userCols))
}

// SeedPlaceholderUser creates a deactivated fictional teammate for demo data
// (visible as assignee/author, can never log in, never admin).
func (s *Store) SeedPlaceholderUser(ctx context.Context, email, displayName string) (User, error) {
	return scanUser(s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, is_active, is_admin)
		VALUES ($1, '!seed', $2, FALSE, FALSE)
		ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING `+userCols, email, displayName))
}

// DeleteUsersByEmailDomain removes seeded placeholder accounts (never admins).
func (s *Store) DeleteUsersByEmailDomain(ctx context.Context, domain string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM users WHERE email LIKE '%@' || $1 AND NOT is_admin AND NOT is_active`, domain)
	return err
}

// IsDemoUser is the read-only gate's lookup (only hit on mutating requests).
func (s *Store) IsDemoUser(ctx context.Context, userID string) (bool, error) {
	var demo bool
	err := s.pool.QueryRow(ctx, `SELECT is_demo FROM users WHERE id = $1`, userID).Scan(&demo)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return demo, err
}

func (s *Store) CreateUser(ctx context.Context, email, passwordHash, displayName string) (User, error) {
	// The first real account on a fresh site becomes the site admin —
	// otherwise a new install has no way to reach Admin settings at all.
	// (Seeded system accounts like TaskHat Automation are inactive and
	// don't count.)
	row := s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, is_admin)
		VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM users WHERE is_active))
		RETURNING `+userCols,
		email, passwordHash, displayName)
	u, err := scanUser(row)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return User{}, ErrEmailTaken
	}
	if err != nil {
		return User{}, fmt.Errorf("create user: %w", err)
	}
	return u, nil
}

func (s *Store) GetUserByID(ctx context.Context, id string) (User, error) {
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1 AND is_active`, id))
}

// GetUserForLogin returns the user and password hash for credential checks.
func (s *Store) GetUserForLogin(ctx context.Context, email string) (User, string, error) {
	var u User
	var hash string
	err := s.pool.QueryRow(ctx,
		`SELECT `+userCols+`, password_hash FROM users WHERE email = $1 AND is_active`, email).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.IsActive, &u.IsDemo, &u.CreatedAt, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	if err != nil {
		return User{}, "", fmt.Errorf("get user for login: %w", err)
	}
	return u, hash, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation
}
