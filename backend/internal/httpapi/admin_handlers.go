package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/auth"
	"github.com/ali-automation/taskhat/backend/internal/mailer"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// requireAdmin gates the /admin API on the is_admin flag.
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isAdmin, err := s.store.IsAdmin(r.Context(), userIDFrom(r.Context()))
		if err != nil {
			s.internalError(w, "admin check", err)
			return
		}
		if !isAdmin {
			writeError(w, http.StatusForbidden, "administrator access required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// smtpConfig resolves SMTP settings: DB values override environment.
func (s *Server) smtpConfig(r *http.Request) mailer.Config {
	cfg := mailer.Config{
		Addr: s.cfg.SMTPAddr, From: s.cfg.SMTPFrom,
		Username: s.cfg.SMTPUsername, Password: s.cfg.SMTPPassword,
	}
	if settings, err := s.store.SiteSettings(r.Context()); err == nil {
		if v := settings["smtp_addr"]; v != "" {
			cfg.Addr = v
		}
		if v := settings["smtp_from"]; v != "" {
			cfg.From = v
		}
		if v := settings["smtp_username"]; v != "" {
			cfg.Username = v
			cfg.Password = settings["smtp_password"]
		}
	}
	return cfg
}

// ---- public: site info + invite acceptance ----

func (s *Server) handleSiteInfo(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.SiteSettings(r.Context())
	if err != nil {
		s.internalError(w, "site settings", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"siteName":         orDefault(settings["site_name"], "TaskHat"),
		"registrationMode": orDefault(settings["registration_mode"], "open"),
		"introduction":     settings["introduction"],
		"language":         orDefault(settings["default_language"], "en"),
		"require2fa":       settings["require_2fa"] == "true",
		"ssoEnabled":       settings["oidc_enabled"] == "true" && settings["oidc_issuer"] != "",
		"ssoLabel":         orDefault(settings["oidc_label"], "Continue with SSO"),
		"demoMode":         s.cfg.DemoMode,
		"demoContactUrl":   s.cfg.DemoContactURL,
		"demoInstagramUrl": s.cfg.DemoInstagramURL,
	})
}

func (s *Server) handleGetInvite(w http.ResponseWriter, r *http.Request) {
	invite, err := s.store.GetInviteByToken(r.Context(), chi.URLParam(r, "token"))
	if errors.Is(err, store.ErrInviteExpired) || errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "this invite link is invalid or has expired")
		return
	}
	if err != nil {
		s.internalError(w, "get invite", err)
		return
	}
	resp := map[string]any{"email": invite.Email, "existingUser": invite.UserID != nil, "displayName": ""}
	if invite.UserID != nil {
		if u, err := s.store.GetProfile(r.Context(), *invite.UserID); err == nil {
			resp["displayName"] = u.DisplayName
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type acceptInviteRequest struct {
	Token       string `json:"token"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	var req acceptInviteRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if minLen := s.minPasswordLen(r); len(req.Password) < minLen {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"password": fmt.Sprintf("password must be at least %d characters", minLen)})
		return
	}
	invite, err := s.store.GetInviteByToken(r.Context(), req.Token)
	if errors.Is(err, store.ErrInviteExpired) || errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "this invite link is invalid or has expired")
		return
	}
	if err != nil {
		s.internalError(w, "get invite", err)
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		s.internalError(w, "hash password", err)
		return
	}
	user, err := s.store.AcceptInvite(r.Context(), invite, strings.TrimSpace(req.DisplayName), hash)
	if err != nil {
		s.internalError(w, "accept invite", err)
		return
	}
	s.applyNewUserDefaults(r, user.ID)
	s.store.Audit(r.Context(), &user.ID, "invite.accepted", user.Email, r.RemoteAddr, nil)
	s.issueTokens(w, r, user, http.StatusOK)
}

// ---- admin: users ----

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListAllUsers(r.Context(), strings.TrimSpace(r.URL.Query().Get("query")))
	if err != nil {
		s.internalError(w, "list users", err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleAdminSetActive(active bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if !active && id == userIDFrom(r.Context()) {
			writeError(w, http.StatusBadRequest, "you cannot deactivate your own account")
			return
		}
		if err := s.store.SetUserActive(r.Context(), id, active); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "user not found")
				return
			}
			s.internalError(w, "set active", err)
			return
		}
		action := "user.deactivated"
		if active {
			action = "user.activated"
		}
		s.audit(r, action, id, nil)
		w.WriteHeader(http.StatusNoContent)
	}
}

type setAdminRequest struct {
	IsAdmin bool `json:"isAdmin"`
}

func (s *Server) handleAdminSetAdmin(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req setAdminRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !req.IsAdmin && id == userIDFrom(r.Context()) {
		writeError(w, http.StatusBadRequest, "you cannot remove your own administrator access")
		return
	}
	if err := s.store.SetUserAdmin(r.Context(), id, req.IsAdmin); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		s.internalError(w, "set admin", err)
		return
	}
	s.audit(r, "user.admin_changed", id, map[string]any{"isAdmin": req.IsAdmin})
	w.WriteHeader(http.StatusNoContent)
}

// ---- admin: invites ----

type createInviteRequest struct {
	Email  string  `json:"email"`
	UserID *string `json:"userId"` // claim an existing (imported) account
}

func (s *Server) handleAdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	var req createInviteRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"email": "valid email required"})
		return
	}
	invite, token, err := s.store.CreateInvite(r.Context(), req.Email, req.UserID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create invite", err)
		return
	}

	inviteURL := s.cfg.BaseURL + "/invite/" + token
	emailSent := false
	if smtp := s.smtpConfig(r); smtp.Enabled() {
		settings, _ := s.store.SiteSettings(r.Context())
		siteName := orDefault(settings["site_name"], "TaskHat")
		body := fmt.Sprintf("%s invited you to %s.\r\n\r\nAccept the invite and set your password:\r\n%s\r\n\r\nThis link expires in 7 days.\r\n",
			invite.InvitedBy.DisplayName, siteName, inviteURL)
		if err := mailer.Send(smtp, req.Email, fmt.Sprintf("You're invited to %s", siteName), body); err != nil {
			s.log.Error("send invite email", "to", req.Email, "error", err)
		} else {
			emailSent = true
		}
	}
	s.audit(r, "invite.created", req.Email, map[string]any{"emailSent": emailSent})
	writeJSON(w, http.StatusCreated, map[string]any{
		"invite":    invite,
		"inviteUrl": inviteURL,
		"emailSent": emailSent,
	})
}

func (s *Server) handleAdminListInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := s.store.ListPendingInvites(r.Context())
	if err != nil {
		s.internalError(w, "list invites", err)
		return
	}
	writeJSON(w, http.StatusOK, invites)
}

func (s *Server) handleAdminDeleteInvite(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteInvite(r.Context(), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "invite not found")
			return
		}
		s.internalError(w, "delete invite", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- admin: spaces, settings, system ----

func (s *Server) handleAdminListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListAllProjects(r.Context())
	if err != nil {
		s.internalError(w, "all projects", err)
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

type setLeadRequest struct {
	Email string `json:"email"`
}

func (s *Server) handleAdminSetLead(w http.ResponseWriter, r *http.Request) {
	var req setLeadRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	user, _, err := s.store.GetUserForLogin(r.Context(), strings.TrimSpace(req.Email))
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"email": "no active user with this email"})
		return
	}
	if err != nil {
		s.internalError(w, "user lookup", err)
		return
	}
	if err := s.store.SetProjectLead(r.Context(), strings.ToUpper(chi.URLParam(r, "key")), user.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "space not found")
			return
		}
		s.internalError(w, "set lead", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminDeleteProject(w http.ResponseWriter, r *http.Request) {
	defer s.audit(r, "space.deleted", strings.ToUpper(chi.URLParam(r, "key")), nil)
	blobKeys, err := s.store.DeleteProject(r.Context(), strings.ToUpper(chi.URLParam(r, "key")))
	for _, key := range blobKeys {
		if delErr := s.blobs.Delete(r.Context(), key); delErr != nil {
			s.log.Error("delete project blob", "key", key, "error", delErr)
		}
	}
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "space not found")
			return
		}
		s.internalError(w, "delete project", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.SiteSettings(r.Context())
	if err != nil {
		s.internalError(w, "settings", err)
		return
	}
	// Never echo the SMTP password; the sentinel tells the UI one is set
	// (and is ignored on save, so round-tripping the form is safe).
	if settings["smtp_password"] != "" {
		settings["smtp_password"] = smtpPasswordSentinel
	}
	// Environment-provided SMTP config (the fallback when the DB overrides
	// above are empty) so the Outgoing-mail page can show what's effective.
	// Underscore prefix = computed, never stored; saves ignore these.
	settings["_smtp_env_addr"] = s.cfg.SMTPAddr
	settings["_smtp_env_from"] = s.cfg.SMTPFrom
	settings["_smtp_env_username"] = s.cfg.SMTPUsername
	if s.cfg.SMTPPassword != "" {
		settings["_smtp_env_password_set"] = "true"
	}
	writeJSON(w, http.StatusOK, settings)
}

// smtpPasswordSentinel stands in for a stored SMTP password in API responses.
const smtpPasswordSentinel = "********"

type updateSettingsRequest struct {
	SiteName           string `json:"site_name"`
	RegistrationMode   string `json:"registration_mode"`
	SMTPAddr           string `json:"smtp_addr"`
	SMTPFrom           string `json:"smtp_from"`
	SMTPUsername       string `json:"smtp_username"`
	SMTPPassword       string `json:"smtp_password"`
	Introduction       string `json:"introduction"`
	DefaultLanguage    string `json:"default_language"`
	CreateProjectsMode string `json:"create_projects_mode"`
	SessionDays        string `json:"session_lifetime_days"`
	MinPasswordLen     string `json:"min_password_len"`
	LockoutAttempts    string `json:"login_lockout_attempts"`
	LockoutMinutes     string `json:"login_lockout_minutes"`
	DefaultTimezone    string `json:"default_timezone"`
	DefaultLanding     string `json:"default_landing_page"`
	Require2FA         string `json:"require_2fa"`
	OIDCEnabled        string `json:"oidc_enabled"`
	OIDCIssuer         string `json:"oidc_issuer"`
	OIDCClientID       string `json:"oidc_client_id"`
	OIDCClientSecret   string `json:"oidc_client_secret"`
	OIDCLabel          string `json:"oidc_label"`
}

func (s *Server) handleAdminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req updateSettingsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.RegistrationMode != "open" && req.RegistrationMode != "invite-only" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"registration_mode": "must be open or invite-only"})
		return
	}
	if strings.TrimSpace(req.SiteName) == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"site_name": "site name required"})
		return
	}
	if req.DefaultLanguage != "" && req.DefaultLanguage != "en" && req.DefaultLanguage != "ar" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"default_language": "must be en or ar"})
		return
	}
	if req.CreateProjectsMode != "" && req.CreateProjectsMode != "everyone" && req.CreateProjectsMode != "admins-only" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"create_projects_mode": "must be everyone or admins-only"})
		return
	}
	for key, value := range map[string]string{
		"site_name":              strings.TrimSpace(req.SiteName),
		"registration_mode":      req.RegistrationMode,
		"smtp_addr":              strings.TrimSpace(req.SMTPAddr),
		"smtp_from":              strings.TrimSpace(req.SMTPFrom),
		"smtp_username":          strings.TrimSpace(req.SMTPUsername),
		"introduction":           strings.TrimSpace(req.Introduction),
		"default_language":       orDefault(req.DefaultLanguage, "en"),
		"create_projects_mode":   orDefault(req.CreateProjectsMode, "everyone"),
		"session_lifetime_days":  orDefault(strings.TrimSpace(req.SessionDays), "30"),
		"min_password_len":       orDefault(strings.TrimSpace(req.MinPasswordLen), "8"),
		"login_lockout_attempts": orDefault(strings.TrimSpace(req.LockoutAttempts), "10"),
		"login_lockout_minutes":  orDefault(strings.TrimSpace(req.LockoutMinutes), "15"),
		"default_timezone":       strings.TrimSpace(req.DefaultTimezone),
		"default_landing_page":   orDefault(req.DefaultLanding, "your-work"),
		"require_2fa":            orDefault(req.Require2FA, "false"),
		"oidc_enabled":           orDefault(req.OIDCEnabled, "false"),
		"oidc_issuer":            strings.TrimSpace(req.OIDCIssuer),
		"oidc_client_id":         strings.TrimSpace(req.OIDCClientID),
		"oidc_client_secret":     strings.TrimSpace(req.OIDCClientSecret),
		"oidc_label":             strings.TrimSpace(req.OIDCLabel),
	} {
		if err := s.store.SetSiteSetting(r.Context(), key, value); err != nil {
			s.internalError(w, "save setting", err)
			return
		}
	}
	// SMTP password: empty or the mask sentinel means "keep the stored one".
	if pw := req.SMTPPassword; pw != "" && pw != smtpPasswordSentinel {
		if err := s.store.SetSiteSetting(r.Context(), "smtp_password", pw); err != nil {
			s.internalError(w, "save setting", err)
			return
		}
	}
	s.audit(r, "settings.updated", "site", nil)
	s.handleAdminGetSettings(w, r)
}

func (s *Server) handleAdminSystem(w http.ResponseWriter, r *http.Request) {
	stats, err := s.store.SystemStats(r.Context())
	if err != nil {
		s.internalError(w, "system stats", err)
		return
	}
	if s.publisher != nil {
		stats["queues"] = s.publisher.QueueDepths([]string{"events.log", "notifications", "imports"})
	}
	writeJSON(w, http.StatusOK, stats)
}
