package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ---- Stage 23: TOTP two-factor ----

// TwoFAState returns the stored secret and whether 2FA is fully enabled.
func (s *Store) TwoFAState(ctx context.Context, userID string) (secret string, enabled bool, err error) {
	var sec *string
	var enabledAt *string
	err = s.pool.QueryRow(ctx,
		`SELECT totp_secret, totp_enabled_at::text FROM users WHERE id = $1`, userID).Scan(&sec, &enabledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, ErrNotFound
	}
	if err != nil {
		return "", false, fmt.Errorf("2fa state: %w", err)
	}
	if sec != nil {
		secret = *sec
	}
	return secret, enabledAt != nil, nil
}

// SetPendingTOTP stores a fresh secret awaiting code confirmation.
func (s *Store) SetPendingTOTP(ctx context.Context, userID, secret string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users SET totp_secret = $2, totp_enabled_at = NULL WHERE id = $1`, userID, secret)
	if err != nil {
		return fmt.Errorf("set pending totp: %w", err)
	}
	return nil
}

// EnableTOTP flips 2FA on and replaces the recovery codes (pre-hashed).
func (s *Store) EnableTOTP(ctx context.Context, userID string, codeHashes []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("enable totp tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE users SET totp_enabled_at = now() WHERE id = $1 AND totp_secret IS NOT NULL`, userID); err != nil {
		return fmt.Errorf("enable totp: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM recovery_codes WHERE user_id = $1`, userID); err != nil {
		return err
	}
	for _, h := range codeHashes {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)`, userID, h); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) DisableTOTP(ctx context.Context, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("disable totp tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM recovery_codes WHERE user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ConsumeRecoveryCode burns an unused recovery code; false when no match.
func (s *Store) ConsumeRecoveryCode(ctx context.Context, userID, codeHash string) (bool, error) {
	ct, err := s.pool.Exec(ctx, `
		UPDATE recovery_codes SET used_at = now()
		WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, userID, codeHash)
	if err != nil {
		return false, fmt.Errorf("consume recovery code: %w", err)
	}
	return ct.RowsAffected() > 0, nil
}
