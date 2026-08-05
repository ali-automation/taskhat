package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage W16: tree & page operations ----

func (s *Server) handleWikiStarState(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	starred, err := s.store.WikiPageStarred(r.Context(), id, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "star state", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"starred": starred})
}

func (s *Server) handleWikiToggleStar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	starred, err := s.store.ToggleWikiStar(r.Context(), id, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "toggle star", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"starred": starred})
}

func (s *Server) handleWikiStarred(w http.ResponseWriter, r *http.Request) {
	pages, err := s.store.ListWikiStarred(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "starred pages", err)
		return
	}
	spaces, err := s.store.ListWikiStarredSpaces(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "starred spaces", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pages": pages, "spaces": spaces})
}

func (s *Server) handleWikiRenamePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	var req struct {
		Title string `json:"title"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"title": "title required"})
		return
	}
	if err := s.store.RenameWikiPage(r.Context(), id, req.Title, userIDFrom(r.Context())); err != nil {
		s.internalError(w, "rename page", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiCopyPage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	newID, err := s.store.CopyWikiPage(r.Context(), id, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		s.internalError(w, "copy page", err)
		return
	}
	page, err := s.store.GetWikiPage(r.Context(), newID)
	if err != nil {
		s.internalError(w, "load copy", err)
		return
	}
	s.publish(r, "wiki.page_created", page)
	writeJSON(w, http.StatusCreated, page)
}

// handleWikiMovePage moves a page (with its subtree) to another space
// and/or parent — the Move… dialog. Needs edit rights on both ends.
func (s *Server) handleWikiMovePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	var req struct {
		SpaceKey string  `json:"spaceKey"`
		ParentID *string `json:"parentId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	target, err := s.store.GetWikiSpace(r.Context(), strings.ToUpper(strings.TrimSpace(req.SpaceKey)))
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"spaceKey": "no space with this key"})
		return
	}
	if err != nil {
		s.internalError(w, "get space", err)
		return
	}
	if _, ok := s.requireWikiSpaceRole(w, r, target.ID, "collaborator"); !ok {
		return
	}
	page, err := s.store.GetWikiPage(r.Context(), id)
	if err != nil {
		s.internalError(w, "get page", err)
		return
	}
	if page.IsHome {
		writeError(w, http.StatusBadRequest, "the space Overview cannot be moved")
		return
	}
	if req.ParentID != nil {
		parent, err := s.store.GetWikiPage(r.Context(), *req.ParentID)
		if errors.Is(err, store.ErrNotFound) || (err == nil && parent.SpaceID != target.ID) {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"parentId": "parent must be a page in the target space"})
			return
		}
		if err != nil {
			s.internalError(w, "get parent", err)
			return
		}
	}
	if err := s.store.MoveWikiPageTo(r.Context(), id, target.ID, req.ParentID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiArchivePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	var req struct {
		Archived bool `json:"archived"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	page, err := s.store.GetWikiPage(r.Context(), id)
	if err != nil {
		s.internalError(w, "get page", err)
		return
	}
	if page.IsHome {
		writeError(w, http.StatusBadRequest, "the space Overview cannot be archived")
		return
	}
	if err := s.store.SetWikiPageArchived(r.Context(), id, req.Archived); err != nil {
		s.internalError(w, "archive page", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiArchivedPages(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	pages, err := s.store.ListArchivedWikiPages(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "archived pages", err)
		return
	}
	writeJSON(w, http.StatusOK, pages)
}

// handleWikiConvertPage flips page ↔ blog (Confluence's Convert menu).
func (s *Server) handleWikiConvertPage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	var req struct {
		Kind string `json:"kind"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	page, err := s.store.GetWikiPage(r.Context(), id)
	if err != nil {
		s.internalError(w, "get page", err)
		return
	}
	if page.IsHome {
		writeError(w, http.StatusBadRequest, "the space Overview cannot be converted")
		return
	}
	if err := s.store.ConvertWikiPageKind(r.Context(), id, req.Kind); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "page not found")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
