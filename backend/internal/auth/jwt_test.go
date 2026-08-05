package auth

import (
	"testing"
	"time"
)

const testSecret = "0123456789abcdef0123456789abcdef"

func TestAccessTokenRoundTrip(t *testing.T) {
	token, err := NewAccessToken(testSecret, "user-123", "sess-1", time.Now())
	if err != nil {
		t.Fatalf("NewAccessToken: %v", err)
	}
	claims, err := ParseAccessToken(testSecret, token)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("UserID = %q, want user-123", claims.UserID)
	}
}

func TestAccessTokenExpired(t *testing.T) {
	token, err := NewAccessToken(testSecret, "user-123", "sess-1", time.Now().Add(-2*AccessTokenTTL))
	if err != nil {
		t.Fatalf("NewAccessToken: %v", err)
	}
	if _, err := ParseAccessToken(testSecret, token); err == nil {
		t.Error("expected expired token to be rejected")
	}
}

func TestAccessTokenWrongSecret(t *testing.T) {
	token, _ := NewAccessToken(testSecret, "user-123", "sess-1", time.Now())
	if _, err := ParseAccessToken("another-secret-another-secret-32", token); err == nil {
		t.Error("expected token signed with different secret to be rejected")
	}
}
