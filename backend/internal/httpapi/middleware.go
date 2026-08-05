package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/ali-automation/taskhat/backend/internal/auth"
)

type ctxKey string

const ctxUserID ctxKey = "userID"
const ctxSessionID ctxKey = "sessionID"

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || token == "" {
			writeError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		// Personal API tokens (tk_…) authenticate scripts and CI.
		if strings.HasPrefix(token, "tk_") {
			userID, err := s.store.UserForAPIToken(r.Context(), token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid or revoked API token")
				return
			}
			ctx := context.WithValue(r.Context(), ctxUserID, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		claims, err := auth.ParseAccessToken(s.cfg.JWTSecret, token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserID, claims.UserID)
		ctx = context.WithValue(ctx, ctxSessionID, claims.SessionID)
		if !s.allowDemoWrite(w, r.WithContext(ctx)) {
			return
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// allowDemoWrite enforces the read-only demo sandbox: in demo mode, mutating
// requests from the demo account are rejected server-side. The lookup only
// runs for mutations, and never when demo mode is off.
func (s *Server) allowDemoWrite(w http.ResponseWriter, r *http.Request) bool {
	if !s.cfg.DemoMode {
		return true
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	// Harmless recently-viewed tracking keeps working for guests.
	if strings.HasSuffix(r.URL.Path, "/viewed") {
		return true
	}
	demo, err := s.store.IsDemoUser(r.Context(), userIDFrom(r.Context()))
	if err != nil || !demo {
		return true
	}
	writeError(w, http.StatusForbidden,
		"the demo account is read-only — request full access to make changes")
	return false
}

func userIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(ctxUserID).(string)
	return id
}

func sessionIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(ctxSessionID).(string)
	return id
}
