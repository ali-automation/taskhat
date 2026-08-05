package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- W11: reactions + views ----

func validEmoji(e string) bool {
	e = strings.TrimSpace(e)
	return e != "" && len(e) <= 32 && utf8.RuneCountInString(e) <= 8
}

func (s *Server) handleWikiPageReactions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	page, comments, err := s.store.WikiPageReactions(r.Context(), id, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "reactions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"page": page, "comments": comments})
}

func (s *Server) handleToggleWikiPageReaction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	var req struct {
		Emoji string `json:"emoji"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if !validEmoji(req.Emoji) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"emoji": "pick an emoji"})
		return
	}
	if _, err := s.store.ToggleWikiReaction(r.Context(), &id, nil, userIDFrom(r.Context()), strings.TrimSpace(req.Emoji)); err != nil {
		s.internalError(w, "toggle reaction", err)
		return
	}
	s.handleWikiPageReactions(w, r)
}

func (s *Server) handleToggleWikiCommentReaction(w http.ResponseWriter, r *http.Request) {
	commentID := chi.URLParam(r, "commentId")
	pageID, err := s.store.WikiCommentPage(r.Context(), commentID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}
	if err != nil {
		s.internalError(w, "wiki comment page", err)
		return
	}
	if !s.requireWikiView(w, r, pageID) {
		return
	}
	var req struct {
		Emoji string `json:"emoji"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if !validEmoji(req.Emoji) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"emoji": "pick an emoji"})
		return
	}
	if _, err := s.store.ToggleWikiReaction(r.Context(), nil, &commentID, userIDFrom(r.Context()), strings.TrimSpace(req.Emoji)); err != nil {
		s.internalError(w, "toggle reaction", err)
		return
	}
	page, comments, err := s.store.WikiPageReactions(r.Context(), pageID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "reactions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"page": page, "comments": comments})
}

// handleWikiPageViewed records "I opened this page" (idempotent per person).
func (s *Server) handleWikiPageViewed(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	if err := s.store.RecordWikiPageView(r.Context(), id, userIDFrom(r.Context())); err != nil {
		s.internalError(w, "record view", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiPageViewers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	viewers, err := s.store.WikiPageViewers(r.Context(), id, 50)
	if err != nil {
		s.internalError(w, "page viewers", err)
		return
	}
	writeJSON(w, http.StatusOK, viewers)
}
