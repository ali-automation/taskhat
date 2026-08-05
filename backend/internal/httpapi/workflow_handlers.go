package httpapi

// Stage 26: the workflow editor — read the full workflow (statuses with
// diagram positions, transitions with rules) and commit a bulk edit.

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

type workflowResponse struct {
	store.WorkflowDetail
	UsedIn []map[string]string `json:"usedIn"`
}

func (s *Server) workflowResponse(r *http.Request, project store.Project) (workflowResponse, error) {
	detail, err := s.store.GetWorkflowDetail(r.Context(), project.WorkflowID)
	if err != nil {
		return workflowResponse{}, err
	}
	// Workflows are per-space since migration 0010, so "used in" is the
	// owning space — kept as a list for Jira parity in the UI chip.
	return workflowResponse{
		WorkflowDetail: detail,
		UsedIn:         []map[string]string{{"key": project.Key, "name": project.Name}},
	}, nil
}

func (s *Server) handleGetWorkflow(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	resp, err := s.workflowResponse(r, project)
	if err != nil {
		s.internalError(w, "get workflow", err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- admin workflows directory (Settings → Work items → Workflows) ----

func (s *Server) handleAdminListWorkflows(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListWorkflowsAdmin(r.Context())
	if err != nil {
		s.internalError(w, "list workflows", err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) adminWorkflowResponse(r *http.Request, workflowID string) (workflowResponse, error) {
	detail, err := s.store.GetWorkflowDetail(r.Context(), workflowID)
	if err != nil {
		return workflowResponse{}, err
	}
	spaces, err := s.store.WorkflowSpaces(r.Context(), workflowID)
	if err != nil {
		return workflowResponse{}, err
	}
	used := []map[string]string{}
	for _, sp := range spaces {
		used = append(used, map[string]string{"key": sp.Key, "name": sp.Name})
	}
	return workflowResponse{WorkflowDetail: detail, UsedIn: used}, nil
}

func (s *Server) handleAdminGetWorkflow(w http.ResponseWriter, r *http.Request) {
	resp, err := s.adminWorkflowResponse(r, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "workflow not found")
		return
	}
	if err != nil {
		s.internalError(w, "get workflow", err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

type adminWorkflowUpdateRequest struct {
	Name string `json:"name"`
	store.WorkflowUpdate
}

func (s *Server) handleAdminUpdateWorkflow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req adminWorkflowUpdateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		if err := s.store.RenameWorkflow(r.Context(), id, name); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "workflow not found")
				return
			}
			s.internalError(w, "rename workflow", err)
			return
		}
	}
	// The editor gates board sync + in-use checks on the owning space.
	projectID, err := s.store.ProjectIDByWorkflow(r.Context(), id)
	if err != nil {
		s.internalError(w, "workflow project", err)
		return
	}
	if _, err := s.store.UpdateWorkflow(r.Context(), projectID, id, req.WorkflowUpdate); err != nil {
		if errors.Is(err, store.ErrWorkflowInvalid) {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"workflow": err.Error()})
			return
		}
		s.internalError(w, "update workflow", err)
		return
	}
	resp, err := s.adminWorkflowResponse(r, id)
	if err != nil {
		s.internalError(w, "get workflow", err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

type createWorkflowRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleAdminCreateWorkflow(w http.ResponseWriter, r *http.Request) {
	var req createWorkflowRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "workflow name required"})
		return
	}
	id, err := s.store.CreateWorkflowAdmin(r.Context(), name)
	if err != nil {
		s.internalError(w, "create workflow", err)
		return
	}
	s.audit(r, "workflow.created", name, nil)
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) handleAdminCopyWorkflow(w http.ResponseWriter, r *http.Request) {
	id, err := s.store.CopyWorkflowAdmin(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "workflow not found")
		return
	}
	if err != nil {
		s.internalError(w, "copy workflow", err)
		return
	}
	s.audit(r, "workflow.copied", id, nil)
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) handleAdminDeleteWorkflow(w http.ResponseWriter, r *http.Request) {
	err := s.store.DeleteWorkflowAdmin(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "workflow not found")
		return
	}
	if errors.Is(err, store.ErrWorkflowInUse) {
		writeError(w, http.StatusBadRequest, "only inactive workflows (used by no space, not the default) can be deleted")
		return
	}
	if err != nil {
		s.internalError(w, "delete workflow", err)
		return
	}
	s.audit(r, "workflow.deleted", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

type assignWorkflowRequest struct {
	ProjectKey string `json:"projectKey"`
}

func (s *Server) handleAdminAssignWorkflow(w http.ResponseWriter, r *http.Request) {
	var req assignWorkflowRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	project, err := s.store.GetProjectByKey(r.Context(), strings.ToUpper(strings.TrimSpace(req.ProjectKey)))
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"projectKey": "space not found"})
		return
	}
	if err != nil {
		s.internalError(w, "project lookup", err)
		return
	}
	if err := s.store.AssignWorkflowToProject(r.Context(), project.ID, chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "workflow not found")
			return
		}
		s.internalError(w, "assign workflow", err)
		return
	}
	s.audit(r, "workflow.assigned", project.Key, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdateWorkflow(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req store.WorkflowUpdate
	if !decodeJSON(w, r, &req) {
		return
	}
	if _, err := s.store.UpdateWorkflow(r.Context(), project.ID, project.WorkflowID, req); err != nil {
		if errors.Is(err, store.ErrWorkflowInvalid) {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"workflow": err.Error()})
			return
		}
		s.internalError(w, "update workflow", err)
		return
	}
	resp, err := s.workflowResponse(r, project)
	if err != nil {
		s.internalError(w, "get workflow", err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
