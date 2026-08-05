package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ---- RFC 6238 TOTP (SHA-1, 6 digits, 30s steps) ----

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func NewTOTPSecret() string {
	buf := make([]byte, 20)
	_, _ = rand.Read(buf)
	return b32.EncodeToString(buf)
}

func totpAt(secret string, counter uint64) (string, error) {
	key, err := b32.DecodeString(secret)
	if err != nil {
		return "", fmt.Errorf("bad totp secret")
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	code := (binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff) % 1_000_000
	return fmt.Sprintf("%06d", code), nil
}

// VerifyTOTP accepts the current step ±1 (clock drift).
func VerifyTOTP(secret, code string, now time.Time) bool {
	counter := uint64(now.Unix() / 30)
	for _, c := range []uint64{counter, counter - 1, counter + 1} {
		if want, err := totpAt(secret, c); err == nil && hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

// ---- short-lived token bridging password → TOTP step ----

type mfaClaims struct {
	UserID  string `json:"uid"`
	Purpose string `json:"purpose"`
	jwt.RegisteredClaims
}

func NewMFAToken(secret, userID string, now time.Time) (string, error) {
	claims := mfaClaims{
		UserID:  userID,
		Purpose: "mfa",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "taskhat",
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func ParseMFAToken(secret, token string) (string, error) {
	parsed, err := jwt.ParseWithClaims(token, &mfaClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil || !parsed.Valid {
		return "", fmt.Errorf("invalid mfa token")
	}
	claims, ok := parsed.Claims.(*mfaClaims)
	if !ok || claims.Purpose != "mfa" {
		return "", fmt.Errorf("invalid mfa token")
	}
	return claims.UserID, nil
}
