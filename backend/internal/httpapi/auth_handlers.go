package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/auth"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

const refreshCookie = "taskhat_refresh"

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type authResponse struct {
	AccessToken string     `json:"accessToken"`
	User        store.User `json:"user"`
	IsAdmin     bool       `json:"isAdmin"`
}

// sessionTTL reads the security setting (days) for refresh-token lifetime.
func (s *Server) sessionTTL(r *http.Request) time.Duration {
	days := s.store.SettingInt(r.Context(), "session_lifetime_days", 30)
	return time.Duration(days) * 24 * time.Hour
}

// minPasswordLen reads the security policy (default 8).
func (s *Server) minPasswordLen(r *http.Request) int {
	return s.store.SettingInt(r.Context(), "min_password_len", 8)
}

// audit records a best-effort audit trail row for the current request.
func (s *Server) audit(r *http.Request, action, target string, details map[string]any) {
	var actor *string
	if id := userIDFrom(r.Context()); id != "" {
		actor = &id
	}
	s.store.Audit(r.Context(), actor, action, target, r.RemoteAddr, details)
}

// loginLocked applies the failed-login lockout policy (Redis counters).
func (s *Server) loginLocked(r *http.Request, email string) bool {
	attempts := s.store.SettingInt(r.Context(), "login_lockout_attempts", 10)
	var count int
	if err := s.rdb.Get(r.Context(), "loginfail:"+email).Scan(&count); err != nil {
		return false
	}
	return count >= attempts
}

func (s *Server) recordLoginFailure(r *http.Request, email string) {
	window := time.Duration(s.store.SettingInt(r.Context(), "login_lockout_minutes", 15)) * time.Minute
	key := "loginfail:" + email
	if n, err := s.rdb.Incr(r.Context(), key).Result(); err == nil && n == 1 {
		s.rdb.Expire(r.Context(), key, window)
	}
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if settings, err := s.store.SiteSettings(r.Context()); err == nil && settings["registration_mode"] == "invite-only" {
		writeError(w, http.StatusForbidden, "registration is invite-only — ask an administrator for an invite")
		return
	}
	var req registerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	fields := map[string]string{}
	req.Email = strings.TrimSpace(req.Email)
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if _, err := mail.ParseAddress(req.Email); err != nil {
		fields["email"] = "valid email required"
	}
	if minLen := s.minPasswordLen(r); len(req.Password) < minLen {
		fields["password"] = fmt.Sprintf("password must be at least %d characters", minLen)
	}
	if req.DisplayName == "" {
		fields["displayName"] = "display name required"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		s.internalError(w, "hash password", err)
		return
	}
	user, err := s.store.CreateUser(r.Context(), req.Email, hash, req.DisplayName)
	if errors.Is(err, store.ErrEmailTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"email": "email already registered"})
		return
	}
	if err != nil {
		s.internalError(w, "create user", err)
		return
	}
	s.applyNewUserDefaults(r, user.ID)
	s.store.Audit(r.Context(), &user.ID, "user.registered", user.Email, r.RemoteAddr, nil)
	s.issueTokens(w, r, user, http.StatusCreated)
}

// applyNewUserDefaults copies the site's default preferences onto a new account.
func (s *Server) applyNewUserDefaults(r *http.Request, userID string) {
	prefs := store.Preferences{
		Timezone:    s.store.SettingStr(r.Context(), "default_timezone", ""),
		Theme:       "auto",
		Language:    s.store.SettingStr(r.Context(), "default_language", "en"),
		LandingPage: s.store.SettingStr(r.Context(), "default_landing_page", "your-work"),
	}
	if _, err := s.store.UpdatePreferences(r.Context(), userID, prefs); err != nil {
		s.log.Error("apply new-user defaults", "error", err)
	}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if s.loginLocked(r, email) {
		minutes := s.store.SettingInt(r.Context(), "login_lockout_minutes", 15)
		s.store.Audit(r.Context(), nil, "login.locked_out", email, r.RemoteAddr, nil)
		writeError(w, http.StatusTooManyRequests,
			fmt.Sprintf("too many failed attempts — try again in up to %d minutes", minutes))
		return
	}
	user, hash, err := s.store.GetUserForLogin(r.Context(), email)
	if errors.Is(err, store.ErrNotFound) {
		s.recordLoginFailure(r, email)
		s.store.Audit(r.Context(), nil, "login.failed", email, r.RemoteAddr, nil)
		writeError(w, http.StatusUnauthorized, "incorrect email or password")
		return
	}
	if err != nil {
		s.internalError(w, "login lookup", err)
		return
	}
	// The shared demo account has no usable password — only /auth/demo.
	if user.IsDemo {
		writeError(w, http.StatusUnauthorized, "incorrect email or password")
		return
	}
	ok, err := auth.VerifyPassword(req.Password, hash)
	if err != nil {
		s.internalError(w, "verify password", err)
		return
	}
	if !ok {
		s.recordLoginFailure(r, email)
		s.store.Audit(r.Context(), nil, "login.failed", email, r.RemoteAddr, nil)
		writeError(w, http.StatusUnauthorized, "incorrect email or password")
		return
	}
	s.rdb.Del(r.Context(), "loginfail:"+email)
	// Second factor required? Hand back a short-lived MFA token instead of a session.
	if _, enabled, err := s.store.TwoFAState(r.Context(), user.ID); err == nil && enabled {
		mfa, err := auth.NewMFAToken(s.cfg.JWTSecret, user.ID, time.Now())
		if err != nil {
			s.internalError(w, "mfa token", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"requires2fa": true, "mfaToken": mfa})
		return
	}
	s.store.Audit(r.Context(), &user.ID, "login.success", user.Email, r.RemoteAddr, nil)
	s.issueTokens(w, r, user, http.StatusOK)
}

// handleDemoLogin signs a visitor in as the shared read-only demo account.
// Only exists when demo mode is enabled; rate-limited per IP.
func (s *Server) handleDemoLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DemoMode {
		writeError(w, http.StatusNotFound, "demo mode is not enabled on this site")
		return
	}
	ip := r.RemoteAddr
	if i := strings.LastIndex(ip, ":"); i > 0 {
		ip = ip[:i]
	}
	if s.rdb != nil {
		n, _ := s.rdb.Incr(r.Context(), "demologin:"+ip).Result()
		if n == 1 {
			s.rdb.Expire(r.Context(), "demologin:"+ip, time.Minute)
		}
		if n > 20 {
			writeError(w, http.StatusTooManyRequests, "too many demo logins — try again in a minute")
			return
		}
	}
	user, err := s.store.GetOrCreateDemoUser(r.Context())
	if err != nil {
		s.internalError(w, "demo user", err)
		return
	}
	s.store.Audit(r.Context(), &user.ID, "login.demo", user.Email, r.RemoteAddr, nil)
	s.issueTokens(w, r, user, http.StatusOK)
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookie)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "missing refresh token")
		return
	}
	userID, sessionID, newToken, err := s.sessions.Rotate(r.Context(), cookie.Value, s.sessionTTL(r))
	if errors.Is(err, auth.ErrSessionNotFound) {
		s.clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "session expired")
		return
	}
	if err != nil {
		s.internalError(w, "rotate session", err)
		return
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		s.clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "user no longer active")
		return
	}
	s.store.TouchSession(r.Context(), sessionID)
	access, err := auth.NewAccessToken(s.cfg.JWTSecret, user.ID, sessionID, time.Now())
	if err != nil {
		s.internalError(w, "sign token", err)
		return
	}
	s.setRefreshCookie(w, newToken)
	isAdmin, _ := s.store.IsAdmin(r.Context(), user.ID)
	writeJSON(w, http.StatusOK, authResponse{AccessToken: access, User: user, IsAdmin: isAdmin})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(refreshCookie); err == nil && cookie.Value != "" {
		sessionID, err := s.sessions.Revoke(r.Context(), cookie.Value)
		if err != nil {
			s.log.Error("revoke session", "error", err)
		} else if sessionID != "" {
			if err := s.store.RevokeSessionRow(r.Context(), userIDFrom(r.Context()), sessionID); err != nil && !errors.Is(err, store.ErrNotFound) {
				s.log.Error("revoke session row", "error", err)
			}
		}
	}
	s.clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.GetUserByID(r.Context(), userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, "user no longer active")
		return
	}
	if err != nil {
		s.internalError(w, "get me", err)
		return
	}
	isAdmin, _ := s.store.IsAdmin(r.Context(), user.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": user.ID, "email": user.Email, "displayName": user.DisplayName,
		"avatarUrl": user.AvatarURL, "isActive": user.IsActive, "createdAt": user.CreatedAt,
		"isAdmin": isAdmin,
	})
}

func (s *Server) issueTokens(w http.ResponseWriter, r *http.Request, user store.User, status int) {
	sessionID, err := s.store.CreateSession(r.Context(), user.ID, r.RemoteAddr, r.UserAgent())
	if err != nil {
		s.internalError(w, "create session row", err)
		return
	}
	access, err := auth.NewAccessToken(s.cfg.JWTSecret, user.ID, sessionID, time.Now())
	if err != nil {
		s.internalError(w, "sign token", err)
		return
	}
	refresh, err := s.sessions.Create(r.Context(), user.ID, sessionID, s.sessionTTL(r))
	if err != nil {
		s.internalError(w, "create session", err)
		return
	}
	s.setRefreshCookie(w, refresh)
	isAdmin, _ := s.store.IsAdmin(r.Context(), user.ID)
	writeJSON(w, status, authResponse{AccessToken: access, User: user, IsAdmin: isAdmin})
}

func (s *Server) setRefreshCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Value:    token,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   s.cfg.Env != "dev",
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(auth.RefreshTokenTTL.Seconds()),
	})
}

func (s *Server) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Value:    "",
		Path:     "/api/v1/auth",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

func (s *Server) internalError(w http.ResponseWriter, msg string, err error) {
	s.log.Error(msg, "error", err)
	writeError(w, http.StatusInternalServerError, "internal server error")
}
