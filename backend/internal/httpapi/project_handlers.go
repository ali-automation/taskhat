package httpapi

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

var projectKeyRe = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)

// requireProject loads the project and verifies the caller is a member.
// Returns the project, the caller's role, and false if a response was written.
func (s *Server) requireProject(w http.ResponseWriter, r *http.Request, key string) (store.Project, string, bool) {
	project, err := s.store.GetProjectByKey(r.Context(), strings.ToUpper(key))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "project not found")
		return store.Project{}, "", false
	}
	if err != nil {
		s.internalError(w, "get project", err)
		return store.Project{}, "", false
	}
	role, err := s.store.MemberRole(r.Context(), project.ID, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusForbidden, "you are not a member of this project")
		return store.Project{}, "", false
	}
	if err != nil {
		s.internalError(w, "member role", err)
		return store.Project{}, "", false
	}
	return project, role, true
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "list projects", err)
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

type createProjectRequest struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	ProjectType string `json:"projectType"`
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	if s.store.SettingStr(r.Context(), "create_projects_mode", "everyone") == "admins-only" {
		if isAdmin, err := s.store.IsAdmin(r.Context(), userIDFrom(r.Context())); err != nil || !isAdmin {
			writeError(w, http.StatusForbidden, "only administrators can create spaces on this site")
			return
		}
	}
	var req createProjectRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Key = strings.ToUpper(strings.TrimSpace(req.Key))
	req.Name = strings.TrimSpace(req.Name)
	if req.ProjectType == "" {
		req.ProjectType = "kanban"
	}
	fields := map[string]string{}
	if !projectKeyRe.MatchString(req.Key) {
		fields["key"] = "2-10 characters, letters and digits, starting with a letter"
	}
	if req.Name == "" {
		fields["name"] = "project name required"
	}
	if req.ProjectType != "kanban" && req.ProjectType != "scrum" {
		fields["projectType"] = "must be kanban or scrum"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	project, err := s.store.CreateProject(r.Context(), req.Key, req.Name, req.Description, req.ProjectType, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrKeyTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"key": "a project with this key already exists"})
		return
	}
	if err != nil {
		s.internalError(w, "create project", err)
		return
	}
	s.audit(r, "space.created", project.Key, map[string]any{"name": project.Name})
	s.publish(r, "project.created", map[string]any{"key": project.Key, "name": project.Name})
	writeJSON(w, http.StatusCreated, project)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, project)
}

type updateProjectRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	if !s.requirePerm(w, r, project.ID, "administer", nil) {
		return
	}
	var req updateProjectRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "project name required"})
		return
	}
	updated, err := s.store.UpdateProject(r.Context(), project.Key, req.Name, req.Description)
	if err != nil {
		s.internalError(w, "update project", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	if !s.requirePerm(w, r, project.ID, "administer", nil) {
		return
	}
	blobKeys, err := s.store.DeleteProject(r.Context(), project.Key)
	if err != nil {
		s.internalError(w, "delete project", err)
		return
	}
	// Import jobs that targeted this space are useless now — drop them with
	// their scan snapshots (which hold a copy of the imported data).
	if jobKeys, err := s.store.DeleteImportJobsForTarget(r.Context(), project.Key, false); err != nil {
		s.log.Error("delete import jobs for space", "key", project.Key, "error", err)
	} else {
		blobKeys = append(blobKeys, jobKeys...)
	}
	for _, key := range blobKeys {
		if err := s.blobs.Delete(r.Context(), key); err != nil {
			s.log.Error("delete project blob", "key", key, "error", err)
		}
	}
	s.audit(r, "space.deleted", project.Key, map[string]any{"blobs": len(blobKeys)})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	members, err := s.store.ListMembers(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "list members", err)
		return
	}
	writeJSON(w, http.StatusOK, members)
}

type addMemberRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	if !s.requirePerm(w, r, project.ID, "administer", nil) {
		return
	}
	var req addMemberRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role != "admin" && req.Role != "member" && req.Role != "viewer" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"role": "must be admin, member or viewer"})
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
	if err := s.store.AddMember(r.Context(), project.ID, user.ID, req.Role); err != nil {
		s.internalError(w, "add member", err)
		return
	}
	writeJSON(w, http.StatusCreated, store.Member{User: user, Role: req.Role})
}

func (s *Server) handleListStatuses(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	statuses, err := s.store.ListStatuses(r.Context(), project.WorkflowID)
	if err != nil {
		s.internalError(w, "list statuses", err)
		return
	}
	writeJSON(w, http.StatusOK, statuses)
}

func (s *Server) handleListLabels(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	labels, err := s.store.ListProjectLabels(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "list labels", err)
		return
	}
	writeJSON(w, http.StatusOK, labels)
}

func (s *Server) handleSearchUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.SearchUsers(r.Context(), r.URL.Query().Get("query"), 20)
	if err != nil {
		s.internalError(w, "search users", err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}
