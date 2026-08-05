package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ali-automation/taskhat/backend/internal/auth"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

func (s *Server) handleGetAccount(w http.ResponseWriter, r *http.Request) {
	profile, err := s.store.GetProfile(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "get account", err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var req store.ProfileUpdate
	if !decodeJSON(w, r, &req) {
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"displayName": "full name required"})
		return
	}
	profile, err := s.store.UpdateProfile(r.Context(), userIDFrom(r.Context()), req)
	if err != nil {
		s.internalError(w, "update profile", err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

// confirmPassword checks the caller's current password for sensitive changes.
func (s *Server) confirmPassword(w http.ResponseWriter, r *http.Request, current string) bool {
	hash, err := s.store.GetPasswordHash(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "password lookup", err)
		return false
	}
	ok, err := auth.VerifyPassword(current, hash)
	if err != nil || !ok {
		writeFieldErrors(w, http.StatusForbidden, map[string]string{"currentPassword": "current password is incorrect"})
		return false
	}
	return true
}

type updateEmailRequest struct {
	Email           string `json:"email"`
	CurrentPassword string `json:"currentPassword"`
}

func (s *Server) handleUpdateEmail(w http.ResponseWriter, r *http.Request) {
	var req updateEmailRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"email": "valid email required"})
		return
	}
	if !s.confirmPassword(w, r, req.CurrentPassword) {
		return
	}
	err := s.store.UpdateEmail(r.Context(), userIDFrom(r.Context()), req.Email)
	if errors.Is(err, store.ErrEmailTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"email": "email already in use"})
		return
	}
	if err != nil {
		s.internalError(w, "update email", err)
		return
	}
	profile, err := s.store.GetProfile(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "get account", err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

type updatePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// handleUpdatePassword changes the password and revokes every other session.
func (s *Server) handleUpdatePassword(w http.ResponseWriter, r *http.Request) {
	var req updatePasswordRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if minLen := s.minPasswordLen(r); len(req.NewPassword) < minLen {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"newPassword": fmt.Sprintf("password must be at least %d characters", minLen)})
		return
	}
	if !s.confirmPassword(w, r, req.CurrentPassword) {
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		s.internalError(w, "hash password", err)
		return
	}
	userID := userIDFrom(r.Context())
	if err := s.store.UpdatePassword(r.Context(), userID, hash); err != nil {
		s.internalError(w, "update password", err)
		return
	}
	s.revokeOtherSessions(r, userID)
	s.audit(r, "password.changed", userID, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) revokeOtherSessions(r *http.Request, userID string) {
	current := sessionIDFrom(r.Context())
	ids, err := s.store.ActiveSessionIDs(r.Context(), userID)
	if err != nil {
		s.log.Error("list sessions", "error", err)
		return
	}
	for _, id := range ids {
		if id == current {
			continue
		}
		if err := s.sessions.RevokeSession(r.Context(), id); err != nil {
			s.log.Error("revoke redis session", "id", id, "error", err)
		}
		if err := s.store.RevokeSessionRow(r.Context(), userID, id); err != nil && !errors.Is(err, store.ErrNotFound) {
			s.log.Error("revoke session row", "id", id, "error", err)
		}
	}
}

func (s *Server) handleUpdatePreferences(w http.ResponseWriter, r *http.Request) {
	var req store.Preferences
	if !decodeJSON(w, r, &req) {
		return
	}
	// Empty fields are left unchanged by the store.
	fields := map[string]string{}
	if req.Theme != "" && req.Theme != "light" && req.Theme != "dark" && req.Theme != "auto" {
		fields["theme"] = "must be light, dark or auto"
	}
	if req.Language != "" && req.Language != "en" && req.Language != "ar" {
		fields["language"] = "must be en or ar"
	}
	if req.LandingPage != "" && req.LandingPage != "your-work" && req.LandingPage != "projects" && req.LandingPage != "issues" {
		fields["landingPage"] = "must be your-work, projects or issues"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	profile, err := s.store.UpdatePreferences(r.Context(), userIDFrom(r.Context()), req)
	if err != nil {
		s.internalError(w, "update preferences", err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

var notifyKinds = map[string]bool{"created": true, "transitioned": true, "updated": true, "comment": true, "mention": true}

func (s *Server) handleGetUserNotifyPrefs(w http.ResponseWriter, r *http.Request) {
	prefs, err := s.store.GetUserNotifyPrefs(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "get notify prefs", err)
		return
	}
	writeJSON(w, http.StatusOK, prefs)
}

func (s *Server) handleUpdateUserNotifyPrefs(w http.ResponseWriter, r *http.Request) {
	var req store.UserNotifyPrefs
	if !decodeJSON(w, r, &req) {
		return
	}
	for kind := range req.Kinds {
		if !notifyKinds[kind] {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{kind: "unknown notification kind"})
			return
		}
	}
	if err := s.store.UpdateUserNotifyPrefs(r.Context(), userIDFrom(r.Context()), req); err != nil {
		s.internalError(w, "update notify prefs", err)
		return
	}
	writeJSON(w, http.StatusOK, req)
}

const maxImageSize = 5 << 20 // 5 MiB

// handleUploadUserImage stores an avatar or header image.
func (s *Server) handleUploadUserImage(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxImageSize)
		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, http.StatusBadRequest, "multipart field 'file' required (max 5 MiB)")
			return
		}
		defer file.Close()
		mime := header.Header.Get("Content-Type")
		if !strings.HasPrefix(mime, "image/") {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"file": "must be an image"})
			return
		}
		key := uuid.NewString()
		if err := s.blobs.Put(r.Context(), key, file, header.Size, mime); err != nil {
			s.internalError(w, "store image", err)
			return
		}
		oldKey, err := s.store.SetUserImage(r.Context(), userIDFrom(r.Context()), kind, &key)
		if err != nil {
			s.internalError(w, "set image", err)
			return
		}
		if oldKey != nil {
			if err := s.blobs.Delete(r.Context(), *oldKey); err != nil {
				s.log.Error("delete old image", "error", err)
			}
		}
		profile, err := s.store.GetProfile(r.Context(), userIDFrom(r.Context()))
		if err != nil {
			s.internalError(w, "get account", err)
			return
		}
		writeJSON(w, http.StatusOK, profile)
	}
}

func (s *Server) handleDeleteUserImage(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		oldKey, err := s.store.SetUserImage(r.Context(), userIDFrom(r.Context()), kind, nil)
		if err != nil {
			s.internalError(w, "clear image", err)
			return
		}
		if oldKey != nil {
			if err := s.blobs.Delete(r.Context(), *oldKey); err != nil {
				s.log.Error("delete image blob", "error", err)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleServeUserImage streams avatars/headers. Intentionally unauthenticated:
// browsers load these via <img>, which cannot send bearer tokens; keys are
// unguessable UUIDs (Gravatar-style pragmatic security).
func (s *Server) handleServeUserImage(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	if _, err := uuid.Parse(key); err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	exists, err := s.store.ImageKeyExists(r.Context(), key)
	if err != nil || !exists {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	body, err := s.blobs.Get(r.Context(), key)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		s.internalError(w, "read image", err)
		return
	}
	defer body.Close()
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, body)
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.store.ListActiveSessions(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "list sessions", err)
		return
	}
	current := sessionIDFrom(r.Context())
	for i := range sessions {
		sessions[i].Current = sessions[i].ID == current
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": sessions})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := userIDFrom(r.Context())
	if err := s.store.RevokeSessionRow(r.Context(), userID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		s.internalError(w, "revoke session", err)
		return
	}
	if err := s.sessions.RevokeSession(r.Context(), id); err != nil {
		s.log.Error("revoke redis session", "error", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRevokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	s.revokeOtherSessions(r, userIDFrom(r.Context()))
	w.WriteHeader(http.StatusNoContent)
}

// handleUserProfile is the public (authenticated) people-page view.
func (s *Server) handleUserProfile(w http.ResponseWriter, r *http.Request) {
	profile, err := s.store.GetProfile(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		s.internalError(w, "get profile", err)
		return
	}
	// Spaces shared between the caller and this user.
	shared, err := s.store.SharedProjects(r.Context(), userIDFrom(r.Context()), profile.ID)
	if err != nil {
		s.internalError(w, "shared projects", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "sharedProjects": shared})
}
