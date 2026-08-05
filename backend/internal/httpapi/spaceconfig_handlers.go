package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// Space settings surfaces beyond the classic Stage-8 set (Jira parity):
// Features toggles, Components CRUD, Permissions view, space custom fields,
// email audit, and a public category list for the Details form.

func (s *Server) handleListCategoriesPublic(w http.ResponseWriter, r *http.Request) {
	cats, err := s.store.ListCategories(r.Context())
	if err != nil {
		s.internalError(w, "list categories", err)
		return
	}
	writeJSON(w, http.StatusOK, cats)
}

func (s *Server) handleSetProjectFeatures(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req struct {
		Features map[string]bool `json:"features"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Features == nil {
		req.Features = map[string]bool{}
	}
	if err := s.store.SetProjectFeatures(r.Context(), project.Key, req.Features); err != nil {
		s.internalError(w, "set features", err)
		return
	}
	updated, err := s.store.GetProjectByKey(r.Context(), project.Key)
	if err != nil {
		s.internalError(w, "get project", err)
		return
	}
	details := map[string]any{}
	for k, v := range req.Features {
		details[k] = v
	}
	s.store.Audit(r.Context(), nil, "space.features_changed", project.Key, r.RemoteAddr, details)
	writeJSON(w, http.StatusOK, updated)
}

// ---- components ----

func (s *Server) handleListComponents(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	comps, err := s.store.ListProjectComponents(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "list components", err)
		return
	}
	writeJSON(w, http.StatusOK, comps)
}

type componentRequest struct {
	Name              string  `json:"name"`
	Description       string  `json:"description"`
	DefaultAssigneeID *string `json:"defaultAssigneeId"`
}

func (s *Server) handleCreateComponent(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req componentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "component name required"})
		return
	}
	id, err := s.store.CreateComponent(r.Context(), project.ID, req.Name, req.Description, req.DefaultAssigneeID)
	if errors.Is(err, store.ErrComponentExists) {
		writeError(w, http.StatusConflict, "a component with that name already exists")
		return
	}
	if err != nil {
		s.internalError(w, "create component", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) handleUpdateComponent(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req componentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "component name required"})
		return
	}
	err := s.store.UpdateComponent(r.Context(), project.ID, chi.URLParam(r, "componentId"), req.Name, req.Description, req.DefaultAssigneeID)
	if errors.Is(err, store.ErrComponentExists) {
		writeError(w, http.StatusConflict, "a component with that name already exists")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "component not found")
		return
	}
	if err != nil {
		s.internalError(w, "update component", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteComponent(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	err := s.store.DeleteComponent(r.Context(), project.ID, chi.URLParam(r, "componentId"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "component not found")
		return
	}
	if err != nil {
		s.internalError(w, "delete component", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- permissions view ----

func (s *Server) handleProjectPermissionScheme(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	id, _, err := s.store.ProjectScheme(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "project scheme", err)
		return
	}
	scheme, err := s.store.GetPermissionScheme(r.Context(), id)
	if err != nil {
		s.internalError(w, "get scheme", err)
		return
	}
	writeJSON(w, http.StatusOK, scheme)
}

// ---- space custom fields ----

func (s *Server) handleSpaceListFields(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	fields, err := s.store.ListProjectFields(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "list fields", err)
		return
	}
	writeJSON(w, http.StatusOK, fields)
}

func (s *Server) handleSpaceCreateField(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req struct {
		Name    string   `json:"name"`
		Type    string   `json:"type"`
		Options []string `json:"options"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "field name required"})
		return
	}
	switch req.Type {
	case "text", "number", "date", "select":
	default:
		writeError(w, http.StatusBadRequest, "field type must be text, number, date or select")
		return
	}
	f, err := s.store.CreateCustomField(r.Context(), &project.ID, req.Name, req.Type, req.Options)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (s *Server) handleSpaceDeleteField(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	f, err := s.store.GetCustomField(r.Context(), chi.URLParam(r, "fieldId"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && (f.ProjectID == nil || *f.ProjectID != project.ID)) {
		writeError(w, http.StatusNotFound, "field not found in this space")
		return
	}
	if err != nil {
		s.internalError(w, "get field", err)
		return
	}
	if err := s.store.DeleteCustomField(r.Context(), f.ID); err != nil {
		s.internalError(w, "delete field", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- email audit ----

func (s *Server) handleSpaceEmailAudit(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	entries, err := s.store.SpaceEmailAudit(r.Context(), project.Key, 100)
	if err != nil {
		s.internalError(w, "email audit", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": entries})
}
