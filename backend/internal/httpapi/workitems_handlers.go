package httpapi

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

var (
	glyphs  = map[string]bool{"epic": true, "story": true, "task": true, "bug": true, "subtask": true}
	colorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

// ---- work types ----

func (s *Server) handleListWorkTypes(w http.ResponseWriter, r *http.Request) {
	types, err := s.store.ListWorkTypes(r.Context(), false)
	if err != nil {
		s.internalError(w, "work types", err)
		return
	}
	writeJSON(w, http.StatusOK, types)
}

func (s *Server) handleAdminListWorkTypes(w http.ResponseWriter, r *http.Request) {
	types, err := s.store.ListWorkTypes(r.Context(), true)
	if err != nil {
		s.internalError(w, "work types", err)
		return
	}
	writeJSON(w, http.StatusOK, types)
}

type workTypeRequest struct {
	Name      string `json:"name"`
	Glyph     string `json:"glyph"`
	Color     string `json:"color"`
	IsEnabled *bool  `json:"isEnabled"`
}

func (s *Server) validateWorkType(w http.ResponseWriter, req *workTypeRequest) bool {
	req.Name = strings.TrimSpace(req.Name)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "name required"
	}
	if req.Glyph == "" {
		req.Glyph = "task"
	}
	if !glyphs[req.Glyph] {
		fields["glyph"] = "must be one of epic, story, task, bug, subtask"
	}
	if req.Color == "" {
		req.Color = "#357DE8"
	}
	if !colorRe.MatchString(req.Color) {
		fields["color"] = "must be a #RRGGBB color"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return false
	}
	return true
}

func (s *Server) handleAdminCreateWorkType(w http.ResponseWriter, r *http.Request) {
	var req workTypeRequest
	if !decodeJSON(w, r, &req) || !s.validateWorkType(w, &req) {
		return
	}
	t, err := s.store.CreateWorkType(r.Context(), req.Name, req.Glyph, req.Color)
	if errors.Is(err, store.ErrTypeTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "a work type with this name already exists"})
		return
	}
	if err != nil {
		s.internalError(w, "create work type", err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) handleAdminUpdateWorkType(w http.ResponseWriter, r *http.Request) {
	var req workTypeRequest
	if !decodeJSON(w, r, &req) || !s.validateWorkType(w, &req) {
		return
	}
	enabled := true
	if req.IsEnabled != nil {
		enabled = *req.IsEnabled
	}
	// "task" is the fallback type across the app; keep it available.
	if !enabled {
		var key string
		if err := s.poolKeyOf(r, chi.URLParam(r, "id"), &key); err == nil && key == "task" {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"isEnabled": "the Task type cannot be disabled"})
			return
		}
	}
	t, err := s.store.UpdateWorkType(r.Context(), chi.URLParam(r, "id"), req.Name, req.Glyph, req.Color, enabled)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "work type not found")
		return
	}
	if err != nil {
		s.internalError(w, "update work type", err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// poolKeyOf looks up a work type's key (small helper for the task guard).
func (s *Server) poolKeyOf(r *http.Request, id string, key *string) error {
	types, err := s.store.ListWorkTypes(r.Context(), true)
	if err != nil {
		return err
	}
	for _, t := range types {
		if t.ID == id {
			*key = t.Key
			return nil
		}
	}
	return store.ErrNotFound
}

func (s *Server) handleAdminDeleteWorkType(w http.ResponseWriter, r *http.Request) {
	err := s.store.DeleteWorkType(r.Context(), chi.URLParam(r, "id"))
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "work type not found")
	case errors.Is(err, store.ErrTypeBuiltin):
		writeError(w, http.StatusBadRequest, "built-in work types cannot be deleted — disable instead")
	case errors.Is(err, store.ErrTypeInUse):
		writeError(w, http.StatusConflict, "work items of this type exist — change their type first")
	case err != nil:
		s.internalError(w, "delete work type", err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---- custom fields ----

func (s *Server) handleListProjectFields(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	fields, err := s.store.ListProjectFields(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "project fields", err)
		return
	}
	writeJSON(w, http.StatusOK, fields)
}

func (s *Server) handleAdminListFields(w http.ResponseWriter, r *http.Request) {
	fields, err := s.store.ListAllCustomFields(r.Context())
	if err != nil {
		s.internalError(w, "fields", err)
		return
	}
	writeJSON(w, http.StatusOK, fields)
}

type fieldRequest struct {
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Options    []string `json:"options"`
	ProjectKey *string  `json:"projectKey"` // nil = all spaces
}

var fieldTypes = map[string]bool{"text": true, "number": true, "date": true, "select": true}

func (s *Server) handleAdminCreateField(w http.ResponseWriter, r *http.Request) {
	var req fieldRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "field name required"
	}
	if !fieldTypes[req.Type] {
		fields["type"] = "must be text, number, date or select"
	}
	options := normalizeOptions(req.Options)
	if req.Type == "select" && len(options) == 0 {
		fields["options"] = "a select field needs at least one option"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	var projectID *string
	if req.ProjectKey != nil && *req.ProjectKey != "" {
		project, err := s.store.GetProjectByKey(r.Context(), strings.ToUpper(*req.ProjectKey))
		if errors.Is(err, store.ErrNotFound) {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"projectKey": "space not found"})
			return
		}
		if err != nil {
			s.internalError(w, "project lookup", err)
			return
		}
		projectID = &project.ID
	}
	f, err := s.store.CreateCustomField(r.Context(), projectID, req.Name, req.Type, options)
	if errors.Is(err, store.ErrFieldTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "a field with this name already exists in this scope"})
		return
	}
	if err != nil {
		s.internalError(w, "create field", err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func normalizeOptions(options []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, o := range options {
		o = strings.TrimSpace(o)
		if o == "" || seen[o] {
			continue
		}
		seen[o] = true
		out = append(out, o)
	}
	return out
}

func (s *Server) handleAdminUpdateField(w http.ResponseWriter, r *http.Request) {
	var req fieldRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "field name required"})
		return
	}
	f, err := s.store.UpdateCustomField(r.Context(), chi.URLParam(r, "id"), req.Name, normalizeOptions(req.Options))
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "field not found")
	case errors.Is(err, store.ErrFieldTaken):
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "a field with this name already exists in this scope"})
	case err != nil:
		s.internalError(w, "update field", err)
	default:
		writeJSON(w, http.StatusOK, f)
	}
}

func (s *Server) handleAdminDeleteField(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCustomField(r.Context(), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "field not found")
			return
		}
		s.internalError(w, "delete field", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- workflow transitions ----

func (s *Server) handleListProjectTransitions(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	transitions, err := s.store.ListWorkflowTransitions(r.Context(), project.WorkflowID)
	if err != nil {
		s.internalError(w, "transitions", err)
		return
	}
	writeJSON(w, http.StatusOK, transitions)
}

type transitionRequest struct {
	Name         string  `json:"name"`
	FromStatusID *string `json:"fromStatusId"` // nil = from any status
	ToStatusID   string  `json:"toStatusId"`
}

func (s *Server) handleCreateProjectTransition(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req transitionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "transition name required"
	}
	if req.ToStatusID == "" {
		fields["toStatusId"] = "target status required"
	}
	if req.FromStatusID != nil && *req.FromStatusID == req.ToStatusID {
		fields["toStatusId"] = "a transition cannot point at its own source"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	if req.FromStatusID != nil && *req.FromStatusID == "" {
		req.FromStatusID = nil
	}
	t, err := s.store.CreateTransition(r.Context(), project.WorkflowID, req.Name, req.FromStatusID, req.ToStatusID)
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"toStatusId": "statuses must belong to this space's workflow"})
		return
	}
	if err != nil {
		s.internalError(w, "create transition", err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) handleDeleteProjectTransition(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteTransition(r.Context(), project.WorkflowID, chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "transition not found")
			return
		}
		s.internalError(w, "delete transition", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
