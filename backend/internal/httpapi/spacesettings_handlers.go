package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// requireProjectAdmin loads the project and requires the administer
// permission of its scheme (site admins always pass).
func (s *Server) requireProjectAdmin(w http.ResponseWriter, r *http.Request) (store.Project, bool) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return store.Project{}, false
	}
	if !s.requirePerm(w, r, project.ID, "administer", nil) {
		return store.Project{}, false
	}
	return project, true
}

// ---- details ----

type updateDetailsRequest struct {
	Name              string  `json:"name"`
	Description       string  `json:"description"`
	LeadID            *string `json:"leadId"`
	DefaultAssigneeID *string `json:"defaultAssigneeId"`
	URL               *string `json:"url"`
	CategoryID        *string `json:"categoryId"`
}

func (s *Server) handleUpdateProjectDetails(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req updateDetailsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "space name required"})
		return
	}
	updated, err := s.store.UpdateProjectDetails(r.Context(), project.Key, store.ProjectDetailsUpdate{
		Name:              req.Name,
		Description:       req.Description,
		LeadID:            req.LeadID,
		DefaultAssigneeID: req.DefaultAssigneeID,
		URL:               req.URL,
		CategoryID:        req.CategoryID,
	})
	if err != nil {
		s.internalError(w, "update details", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleUploadProjectAvatar(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
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
	oldKey, err := s.store.SetProjectImage(r.Context(), project.ID, &key)
	if err != nil {
		s.internalError(w, "set space avatar", err)
		return
	}
	if oldKey != nil {
		if err := s.blobs.Delete(r.Context(), *oldKey); err != nil {
			s.log.Error("delete old space avatar", "error", err)
		}
	}
	updated, err := s.store.GetProjectByKey(r.Context(), project.Key)
	if err != nil {
		s.internalError(w, "get project", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteProjectAvatar(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	oldKey, err := s.store.SetProjectImage(r.Context(), project.ID, nil)
	if err != nil {
		s.internalError(w, "clear space avatar", err)
		return
	}
	if oldKey != nil {
		if err := s.blobs.Delete(r.Context(), *oldKey); err != nil {
			s.log.Error("delete space avatar blob", "error", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- access ----

type memberRoleRequest struct {
	Role string `json:"role"`
}

func (s *Server) handleUpdateMemberRole(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req memberRoleRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Role != "admin" && req.Role != "member" && req.Role != "viewer" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"role": "must be admin, member or viewer"})
		return
	}
	targetID := chi.URLParam(r, "userId")
	if targetID == userIDFrom(r.Context()) && req.Role != "admin" {
		writeError(w, http.StatusBadRequest, "you cannot remove your own admin role")
		return
	}
	if err := s.store.UpdateMemberRole(r.Context(), project.ID, targetID, req.Role); err != nil {
		if errors.Is(err, store.ErrMemberNotFound) {
			writeError(w, http.StatusNotFound, "member not found")
			return
		}
		s.internalError(w, "update member role", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	targetID := chi.URLParam(r, "userId")
	if targetID == userIDFrom(r.Context()) {
		writeError(w, http.StatusBadRequest, "you cannot remove yourself from the space")
		return
	}
	if err := s.store.RemoveMember(r.Context(), project.ID, targetID); err != nil {
		switch {
		case errors.Is(err, store.ErrLeadRemoval):
			writeError(w, http.StatusBadRequest, "the space lead cannot be removed — change the lead first")
		case errors.Is(err, store.ErrMemberNotFound):
			writeError(w, http.StatusNotFound, "member not found")
		default:
			s.internalError(w, "remove member", err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- labels ----

func (s *Server) handleLabelInfo(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	labels, err := s.store.ListLabelInfo(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "label info", err)
		return
	}
	writeJSON(w, http.StatusOK, labels)
}

type renameLabelRequest struct {
	NewName string `json:"newName"`
}

func (s *Server) handleRenameLabel(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req renameLabelRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	newName := strings.Join(strings.Fields(req.NewName), "-") // labels are single tokens
	if newName == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"newName": "label name required"})
		return
	}
	if err := s.store.RenameLabel(r.Context(), project.ID, chi.URLParam(r, "name"), newName); err != nil {
		if errors.Is(err, store.ErrLabelNotFound) {
			writeError(w, http.StatusNotFound, "label not found")
			return
		}
		s.internalError(w, "rename label", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteLabel(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteLabel(r.Context(), project.ID, chi.URLParam(r, "name")); err != nil {
		if errors.Is(err, store.ErrLabelNotFound) {
			writeError(w, http.StatusNotFound, "label not found")
			return
		}
		s.internalError(w, "delete label", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- statuses ----

type createStatusRequest struct {
	Name     string `json:"name"`
	Category string `json:"category"`
}

func (s *Server) handleCreateStatus(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req createStatusRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "status name required"
	}
	if req.Category != "todo" && req.Category != "in_progress" && req.Category != "done" {
		fields["category"] = "must be todo, in_progress or done"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	status, err := s.store.AddStatus(r.Context(), project.ID, project.WorkflowID, req.Name, req.Category)
	if err != nil {
		s.internalError(w, "add status", err)
		return
	}
	writeJSON(w, http.StatusCreated, status)
}

type renameStatusRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleRenameStatus(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req renameStatusRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "status name required"})
		return
	}
	if err := s.store.RenameStatus(r.Context(), project.WorkflowID, chi.URLParam(r, "id"), req.Name); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "status not found")
			return
		}
		s.internalError(w, "rename status", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteStatus(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	err := s.store.DeleteStatus(r.Context(), project.ID, project.WorkflowID, chi.URLParam(r, "id"))
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "status not found")
	case errors.Is(err, store.ErrStatusInUse):
		writeError(w, http.StatusConflict, "move the work items in this status first, then delete it")
	case errors.Is(err, store.ErrLastStatus):
		writeError(w, http.StatusBadRequest, "a workflow needs at least one status")
	case err != nil:
		s.internalError(w, "delete status", err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---- board column order ----

type reorderColumnsRequest struct {
	ColumnIDs []string `json:"columnIds"`
}

func (s *Server) handleReorderColumns(w http.ResponseWriter, r *http.Request) {
	board, _, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, board.ProjectID, "administer", nil) {
		return
	}
	var req reorderColumnsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.ColumnIDs) == 0 {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"columnIds": "column ids required"})
		return
	}
	if err := s.store.ReorderColumns(r.Context(), board.ID, req.ColumnIDs); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "unknown column id")
			return
		}
		s.internalError(w, "reorder columns", err)
		return
	}
	updated, err := s.store.GetBoard(r.Context(), board.ID)
	if err != nil {
		s.internalError(w, "get board", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ---- archive & notifications ----

func (s *Server) handleSetArchived(archived bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		project, ok := s.requireProjectAdmin(w, r)
		if !ok {
			return
		}
		updated, err := s.store.SetProjectArchived(r.Context(), project.Key, archived)
		if err != nil {
			s.internalError(w, "set archived", err)
			return
		}
		action := "space.unarchived"
		if archived {
			action = "space.archived"
		}
		s.audit(r, action, project.Key, nil)
		writeJSON(w, http.StatusOK, updated)
	}
}

func (s *Server) handleUpdateNotifyPrefs(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req map[string]bool
	if !decodeJSON(w, r, &req) {
		return
	}
	allowed := map[string]bool{"created": true, "transitioned": true, "updated": true, "comment": true}
	prefs := map[string]bool{}
	for k, v := range req {
		if !allowed[k] {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{k: "unknown notification kind"})
			return
		}
		prefs[k] = v
	}
	updated, err := s.store.UpdateNotifyPrefs(r.Context(), project.Key, prefs)
	if err != nil {
		s.internalError(w, "update notify prefs", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
