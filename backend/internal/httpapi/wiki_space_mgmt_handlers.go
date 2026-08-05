package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage W17: space management ----

func (s *Server) handleWikiSpaceFlags(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	starred, watching, err := s.store.WikiSpaceFlags(r.Context(), space.ID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "space flags", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"starred": starred, "watching": watching})
}

func (s *Server) handleWikiSpaceStar(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	starred, err := s.store.ToggleWikiSpaceStar(r.Context(), space.ID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "star space", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"starred": starred})
}

func (s *Server) handleWikiSpaceWatch(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	watching, err := s.store.ToggleWikiSpaceWatch(r.Context(), space.ID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "watch space", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"watching": watching})
}

func (s *Server) handleWikiSpaceIcon(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		Icon string `json:"icon"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Icon) > 32 {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"icon": "icon too long"})
		return
	}
	if err := s.store.SetWikiSpaceIcon(r.Context(), space.ID, req.Icon); err != nil {
		s.internalError(w, "space icon", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiSpaceOwner(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	user, _, err := s.store.GetUserForLogin(r.Context(), strings.TrimSpace(req.Email))
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"email": "no user with this email"})
		return
	}
	if err != nil {
		s.internalError(w, "owner lookup", err)
		return
	}
	if err := s.store.SetWikiSpaceOwner(r.Context(), space.ID, user.ID); err != nil {
		s.internalError(w, "set owner", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiSpaceHome(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		PageID string `json:"pageId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.SetWikiSpaceHome(r.Context(), space.ID, req.PageID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "page not found")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiSpaceCategories(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		Categories []string `json:"categories"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	cleaned := []string{}
	for _, c := range req.Categories {
		c = strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(c)), "-"))
		if c != "" && len(c) <= 60 {
			cleaned = append(cleaned, c)
		}
	}
	if len(cleaned) > 12 {
		cleaned = cleaned[:12]
	}
	if err := s.store.SetWikiSpaceCategories(r.Context(), space.ID, cleaned); err != nil {
		s.internalError(w, "space categories", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiSpaceArchive(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		Archived bool `json:"archived"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.SetWikiSpaceArchived(r.Context(), space.ID, req.Archived); err != nil {
		s.internalError(w, "archive space", err)
		return
	}
	s.audit(r, "wiki_space.archived", space.Key, map[string]any{"archived": req.Archived})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiSpaceDelete(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	blobKeys, err := s.store.DeleteWikiSpace(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "delete space", err)
		return
	}
	// Confluence import jobs that targeted this space go too, with their
	// scan snapshots (which hold a copy of the imported data).
	if jobKeys, err := s.store.DeleteImportJobsForTarget(r.Context(), space.Key, true); err != nil {
		s.log.Error("delete import jobs for wiki space", "key", space.Key, "error", err)
	} else {
		blobKeys = append(blobKeys, jobKeys...)
	}
	// Best-effort blob cleanup — the rows are gone either way.
	for _, key := range blobKeys {
		if err := s.blobs.Delete(r.Context(), key); err != nil {
			s.log.Error("delete space blob", "key", key, "error", err)
		}
	}
	s.audit(r, "wiki_space.deleted", space.Key, map[string]any{"blobs": len(blobKeys)})
	w.WriteHeader(http.StatusNoContent)
}

// ---- trash ----

func (s *Server) handleWikiTrash(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	pages, err := s.store.ListWikiTrash(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "wiki trash", err)
		return
	}
	writeJSON(w, http.StatusOK, pages)
}

// requireTrashAdmin gates restore/purge: space admin of the trashed page.
func (s *Server) requireTrashAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	spaceID, err := s.store.WikiPageSpaceID(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return "", false
	}
	if err != nil {
		s.internalError(w, "page space", err)
		return "", false
	}
	if _, ok := s.requireWikiSpaceRole(w, r, spaceID, "admin"); !ok {
		return "", false
	}
	return id, true
}

func (s *Server) handleWikiRestoreTrashed(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireTrashAdmin(w, r)
	if !ok {
		return
	}
	if err := s.store.RestoreWikiPage(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "page is not in the trash")
			return
		}
		s.internalError(w, "restore page", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWikiPurgeTrashed(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireTrashAdmin(w, r)
	if !ok {
		return
	}
	blobKeys, err := s.store.PurgeWikiPage(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "page is not in the trash")
			return
		}
		s.internalError(w, "purge page", err)
		return
	}
	for _, key := range blobKeys {
		if err := s.blobs.Delete(r.Context(), key); err != nil {
			s.log.Error("purge page blob", "key", key, "error", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
