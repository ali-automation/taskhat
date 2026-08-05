package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage W12: space roles & custom templates ----

func writeWikiRoleError(w http.ResponseWriter, minRole string) {
	if minRole == "admin" {
		writeError(w, http.StatusForbidden, "only space admins can do this")
		return
	}
	writeError(w, http.StatusForbidden, "you have view-only access to this space")
}

// requireWikiSpaceRole gates a space-level action; "" role means no access at all.
func (s *Server) requireWikiSpaceRole(w http.ResponseWriter, r *http.Request, spaceID, minRole string) (string, bool) {
	role, err := s.store.WikiSpaceRole(r.Context(), spaceID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "wiki role", err)
		return "", false
	}
	if role == "" {
		writeError(w, http.StatusNotFound, "wiki space not found")
		return "", false
	}
	if !store.WikiRoleAtLeast(role, minRole) {
		writeWikiRoleError(w, minRole)
		return "", false
	}
	return role, true
}

// requireWikiPageRole gates a page-level action: page restrictions (view)
// plus the space role ladder.
func (s *Server) requireWikiPageRole(w http.ResponseWriter, r *http.Request, pageID, minRole string) bool {
	if !s.requireWikiView(w, r, pageID) {
		return false
	}
	spaceID, err := s.store.WikiPageSpaceID(r.Context(), pageID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return false
	}
	if err != nil {
		s.internalError(w, "wiki page space", err)
		return false
	}
	_, ok := s.requireWikiSpaceRole(w, r, spaceID, minRole)
	return ok
}

// requireWikiSpaceByKey loads a space and applies the role gate in one step.
func (s *Server) requireWikiSpaceByKey(w http.ResponseWriter, r *http.Request, minRole string) (store.WikiSpace, string, bool) {
	space, err := s.store.GetWikiSpace(r.Context(), strings.ToUpper(chi.URLParam(r, "key")))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "wiki space not found")
		return store.WikiSpace{}, "", false
	}
	if err != nil {
		s.internalError(w, "get wiki space", err)
		return store.WikiSpace{}, "", false
	}
	role, ok := s.requireWikiSpaceRole(w, r, space.ID, minRole)
	return space, role, ok
}

// ---- space settings: details, access, members ----

func (s *Server) handleUpdateWikiSpace(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "space name required"})
		return
	}
	if err := s.store.UpdateWikiSpace(r.Context(), space.ID, req.Name, strings.TrimSpace(req.Description)); err != nil {
		s.internalError(w, "update wiki space", err)
		return
	}
	updated, err := s.store.GetWikiSpace(r.Context(), space.Key)
	if err != nil {
		s.internalError(w, "get wiki space", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleSetWikiSpaceAccess(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		DefaultRole string `json:"defaultRole"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.DefaultRole != "collaborator" && req.DefaultRole != "viewer" && req.DefaultRole != "none" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"defaultRole": "must be collaborator, viewer or none"})
		return
	}
	if err := s.store.SetWikiSpaceDefaultRole(r.Context(), space.ID, req.DefaultRole); err != nil {
		s.internalError(w, "set wiki access", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListWikiSpaceMembers(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	members, err := s.store.ListWikiSpaceMembers(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "wiki members", err)
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (s *Server) handleSetWikiSpaceMember(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Role != "admin" && req.Role != "collaborator" && req.Role != "viewer" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"role": "must be admin, collaborator or viewer"})
		return
	}
	user, _, err := s.store.GetUserForLogin(r.Context(), strings.TrimSpace(req.Email))
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"email": "no user with this email"})
		return
	}
	if err != nil {
		s.internalError(w, "member lookup", err)
		return
	}
	if err := s.store.SetWikiSpaceMember(r.Context(), space.ID, user.ID, req.Role); err != nil {
		s.internalError(w, "set wiki member", err)
		return
	}
	members, err := s.store.ListWikiSpaceMembers(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "wiki members", err)
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (s *Server) handleRemoveWikiSpaceMember(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "admin")
	if !ok {
		return
	}
	if err := s.store.RemoveWikiSpaceMember(r.Context(), space.ID, chi.URLParam(r, "userId")); err != nil {
		s.internalError(w, "remove wiki member", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- custom templates ----

func (s *Server) handleListWikiTemplates(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	templates, err := s.store.ListWikiTemplates(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "wiki templates", err)
		return
	}
	writeJSON(w, http.StatusOK, templates)
}

func (s *Server) handleCreateWikiTemplate(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "collaborator")
	if !ok {
		return
	}
	var req struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Icon        string          `json:"icon"`
		BodyDoc     json.RawMessage `json:"bodyDoc"`
		FromPageID  string          `json:"fromPageId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "template name required"})
		return
	}
	body := req.BodyDoc
	if req.FromPageID != "" {
		if !s.requireWikiView(w, r, req.FromPageID) {
			return
		}
		page, err := s.store.GetWikiPage(r.Context(), req.FromPageID)
		if errors.Is(err, store.ErrNotFound) || (err == nil && page.SpaceID != space.ID) {
			writeError(w, http.StatusNotFound, "page not found")
			return
		}
		if err != nil {
			s.internalError(w, "get wiki page", err)
			return
		}
		body = page.BodyDoc
		if req.Icon == "" {
			req.Icon = page.Icon
		}
	}
	id, err := s.store.CreateWikiTemplate(r.Context(), space.ID, req.Name,
		strings.TrimSpace(req.Description), req.Icon, body, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrTemplateExists) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "a template with this name already exists"})
		return
	}
	if err != nil {
		s.internalError(w, "create wiki template", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) handleDeleteWikiTemplate(w http.ResponseWriter, r *http.Request) {
	spaceID, createdBy, err := s.store.WikiTemplateMeta(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		s.internalError(w, "wiki template", err)
		return
	}
	// The template's author can delete it; anyone else needs space admin.
	if createdBy == nil || *createdBy != userIDFrom(r.Context()) {
		if _, ok := s.requireWikiSpaceRole(w, r, spaceID, "admin"); !ok {
			return
		}
	}
	if err := s.store.DeleteWikiTemplate(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.internalError(w, "delete wiki template", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- Stage W13: blog feed ----

func (s *Server) handleWikiBlogFeed(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	posts, err := s.store.ListWikiBlogPosts(r.Context(), space.ID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "wiki blog feed", err)
		return
	}
	writeJSON(w, http.StatusOK, posts)
}
