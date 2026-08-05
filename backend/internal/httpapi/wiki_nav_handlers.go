package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage W19: shortcuts + personal space ----

func (s *Server) handleWikiListShortcuts(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	shortcuts, err := s.store.ListWikiShortcuts(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "shortcuts", err)
		return
	}
	writeJSON(w, http.StatusOK, shortcuts)
}

func (s *Server) handleWikiCreateShortcut(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "collaborator")
	if !ok {
		return
	}
	var req struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.URL = strings.TrimSpace(req.URL)
	fields := map[string]string{}
	if req.Title == "" {
		fields["title"] = "title required"
	}
	if req.URL == "" || !(strings.HasPrefix(req.URL, "http://") || strings.HasPrefix(req.URL, "https://") || strings.HasPrefix(req.URL, "/")) {
		fields["url"] = "must be an http(s) URL or an app path starting with /"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	existing, err := s.store.ListWikiShortcuts(r.Context(), space.ID)
	if err == nil && len(existing) >= 12 {
		writeError(w, http.StatusBadRequest, "a space can have at most 12 shortcuts")
		return
	}
	id, err := s.store.CreateWikiShortcut(r.Context(), space.ID, req.Title, req.URL, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create shortcut", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) handleWikiDeleteShortcut(w http.ResponseWriter, r *http.Request) {
	spaceID, err := s.store.WikiShortcutSpace(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shortcut not found")
		return
	}
	if err != nil {
		s.internalError(w, "shortcut", err)
		return
	}
	if _, ok := s.requireWikiSpaceRole(w, r, spaceID, "collaborator"); !ok {
		return
	}
	if err := s.store.DeleteWikiShortcut(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.internalError(w, "delete shortcut", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleWikiPersonalSpace creates the caller's private space on first use.
func (s *Server) handleWikiPersonalSpace(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.GetUserByID(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "get user", err)
		return
	}
	space, err := s.store.PersonalWikiSpace(r.Context(), user.ID, user.DisplayName, user.Email)
	if err != nil {
		s.internalError(w, "personal space", err)
		return
	}
	writeJSON(w, http.StatusOK, space)
}

// handleWikiContributors feeds the search Contributor filter, scoped to a
// space when one is selected.
func (s *Server) handleWikiContributors(w http.ResponseWriter, r *http.Request) {
	spaceKey := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("space")))
	users, err := s.store.WikiContributors(r.Context(), userIDFrom(r.Context()), spaceKey)
	if err != nil {
		s.internalError(w, "wiki contributors", err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

// handleWikiForYou powers the DocHat home: pick-up cards + activity feeds.
func (s *Server) handleWikiForYou(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r.Context())
	pickUp, err := s.store.WikiPickUp(r.Context(), userID, 6)
	if err != nil {
		s.internalError(w, "pick up", err)
		return
	}
	following, err := s.store.WikiFollowingFeed(r.Context(), userID, 15)
	if err != nil {
		s.internalError(w, "following feed", err)
		return
	}
	popular, err := s.store.WikiPopularFeed(r.Context(), userID, 15)
	if err != nil {
		s.internalError(w, "popular feed", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pickUp": pickUp, "following": following, "popular": popular})
}
