package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RefreshTokenTTL is the default session lifetime; the API can override it
// per call from the site's security settings.
const RefreshTokenTTL = 30 * 24 * time.Hour

var ErrSessionNotFound = errors.New("session not found")

// Sessions stores refresh tokens in Redis so they can be revoked and rotated.
// Each token references a Postgres session row (device metadata); the reverse
// index session:{id} → token makes per-session revocation possible.
type Sessions struct {
	rdb *redis.Client
}

func NewSessions(rdb *redis.Client) *Sessions {
	return &Sessions{rdb: rdb}
}

type refreshEntry struct {
	UserID    string `json:"u"`
	SessionID string `json:"s"`
}

func refreshKey(token string) string     { return "refresh:" + token }
func sessionKey(sessionID string) string { return "session:" + sessionID }

func newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate refresh token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// Create issues a refresh token bound to a session. ttl <= 0 uses the default.
func (s *Sessions) Create(ctx context.Context, userID, sessionID string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = RefreshTokenTTL
	}
	token, err := newToken()
	if err != nil {
		return "", err
	}
	entry, _ := json.Marshal(refreshEntry{UserID: userID, SessionID: sessionID})
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, refreshKey(token), entry, ttl)
	pipe.Set(ctx, sessionKey(sessionID), token, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("store refresh token: %w", err)
	}
	return token, nil
}

// Rotate atomically consumes a refresh token and issues a new one for the
// same user + session.
func (s *Sessions) Rotate(ctx context.Context, token string, ttl time.Duration) (userID, sessionID, newTok string, err error) {
	raw, err := s.rdb.GetDel(ctx, refreshKey(token)).Result()
	if errors.Is(err, redis.Nil) {
		return "", "", "", ErrSessionNotFound
	}
	if err != nil {
		return "", "", "", fmt.Errorf("lookup refresh token: %w", err)
	}
	var entry refreshEntry
	if jsonErr := json.Unmarshal([]byte(raw), &entry); jsonErr != nil {
		return "", "", "", ErrSessionNotFound // pre-migration format: force re-login
	}
	newTok, err = s.Create(ctx, entry.UserID, entry.SessionID, ttl)
	if err != nil {
		return "", "", "", err
	}
	return entry.UserID, entry.SessionID, newTok, nil
}

// Revoke deletes a refresh token and its session index (logout).
func (s *Sessions) Revoke(ctx context.Context, token string) (sessionID string, err error) {
	raw, err := s.rdb.GetDel(ctx, refreshKey(token)).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var entry refreshEntry
	if json.Unmarshal([]byte(raw), &entry) == nil && entry.SessionID != "" {
		s.rdb.Del(ctx, sessionKey(entry.SessionID))
		return entry.SessionID, nil
	}
	return "", nil
}

// RevokeSession kills a session by id (from the sessions list UI).
func (s *Sessions) RevokeSession(ctx context.Context, sessionID string) error {
	token, err := s.rdb.GetDel(ctx, sessionKey(sessionID)).Result()
	if errors.Is(err, redis.Nil) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.rdb.Del(ctx, refreshKey(token)).Err()
}
