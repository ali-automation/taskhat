package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage 24: Permission schemes ----

// permissionLabels drives the 403 message; keep in sync with store.Permissions.
var permissionLabels = map[string]string{
	"administer":         "Administer space",
	"create":             "Create work items",
	"edit":               "Edit work items",
	"transition":         "Transition work items",
	"delete":             "Delete work items",
	"assign":             "Assign work items",
	"link":               "Link work items",
	"comment":            "Add comments",
	"comment-edit-all":   "Edit all comments",
	"comment-delete-all": "Delete all comments",
	"attach":             "Create attachments",
	"attach-delete-all":  "Delete all attachments",
	"manage-sprints":     "Manage sprints",
	"manage-versions":    "Manage releases",
	"log-work":           "Log work",
}

// hasPerm resolves a permission through the space's scheme. Site admins
// implicitly hold "administer" so a misconfigured scheme can always be fixed.
func (s *Server) hasPerm(r *http.Request, projectID, perm string, issue *store.Issue) (bool, error) {
	userID := userIDFrom(r.Context())
	reporterID, assigneeID := "", ""
	if issue != nil {
		reporterID = issue.Reporter.ID
		if issue.Assignee != nil {
			assigneeID = issue.Assignee.ID
		}
	}
	ok, err := s.store.HasPermission(r.Context(), projectID, userID, perm, reporterID, assigneeID)
	if err != nil || ok {
		return ok, err
	}
	if perm == "administer" {
		return s.store.IsAdmin(r.Context(), userID)
	}
	return false, nil
}

// requirePerm writes a Jira-style 403 naming the missing permission.
func (s *Server) requirePerm(w http.ResponseWriter, r *http.Request, projectID, perm string, issue *store.Issue) bool {
	ok, err := s.hasPerm(r, projectID, perm, issue)
	if err != nil {
		s.internalError(w, "check permission", err)
		return false
	}
	if !ok {
		writeError(w, http.StatusForbidden,
			"you don't have the '"+permissionLabels[perm]+"' permission in this space")
		return false
	}
	return true
}

// handleMyPermissions lets the UI adapt to the caller's scheme grants.
func (s *Server) handleMyPermissions(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	perms, err := s.store.MyPermissions(r.Context(), project.ID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "my permissions", err)
		return
	}
	if isAdmin, _ := s.store.IsAdmin(r.Context(), userIDFrom(r.Context())); isAdmin {
		found := false
		for _, p := range perms {
			if p == "administer" {
				found = true
			}
		}
		if !found {
			perms = append(perms, "administer")
		}
	}
	schemeID, schemeName, err := s.store.ProjectScheme(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "project scheme", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"permissions": perms,
		"scheme":      map[string]string{"id": schemeID, "name": schemeName},
	})
}

// ---- site-admin scheme management ----

func (s *Server) handleAdminListSchemes(w http.ResponseWriter, r *http.Request) {
	schemes, err := s.store.ListPermissionSchemes(r.Context())
	if err != nil {
		s.internalError(w, "list schemes", err)
		return
	}
	writeJSON(w, http.StatusOK, schemes)
}

type schemeRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CopyFrom    string `json:"copyFrom"`
}

func (s *Server) handleAdminCreateScheme(w http.ResponseWriter, r *http.Request) {
	var req schemeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "scheme name required"})
		return
	}
	id, err := s.store.CreatePermissionScheme(r.Context(), req.Name, strings.TrimSpace(req.Description), req.CopyFrom)
	if errors.Is(err, store.ErrSchemeExists) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "a scheme with this name already exists"})
		return
	}
	if err != nil {
		s.internalError(w, "create scheme", err)
		return
	}
	s.audit(r, "permission_scheme.created", req.Name, nil)
	scheme, err := s.store.GetPermissionScheme(r.Context(), id)
	if err != nil {
		s.internalError(w, "get scheme", err)
		return
	}
	writeJSON(w, http.StatusCreated, scheme)
}

func (s *Server) handleAdminGetScheme(w http.ResponseWriter, r *http.Request) {
	scheme, err := s.store.GetPermissionScheme(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "scheme not found")
		return
	}
	if err != nil {
		s.internalError(w, "get scheme", err)
		return
	}
	writeJSON(w, http.StatusOK, scheme)
}

func (s *Server) handleAdminUpdateScheme(w http.ResponseWriter, r *http.Request) {
	var req schemeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "scheme name required"})
		return
	}
	id := chi.URLParam(r, "id")
	if err := s.store.UpdatePermissionScheme(r.Context(), id, req.Name, strings.TrimSpace(req.Description)); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "scheme not found")
			return
		}
		s.internalError(w, "update scheme", err)
		return
	}
	s.audit(r, "permission_scheme.updated", req.Name, nil)
	scheme, err := s.store.GetPermissionScheme(r.Context(), id)
	if err != nil {
		s.internalError(w, "get scheme", err)
		return
	}
	writeJSON(w, http.StatusOK, scheme)
}

func (s *Server) handleAdminDeleteScheme(w http.ResponseWriter, r *http.Request) {
	err := s.store.DeletePermissionScheme(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrSchemeInUse) {
		writeError(w, http.StatusBadRequest, "this scheme is used by a space — assign those spaces another scheme first")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "scheme not found (the default scheme cannot be deleted)")
		return
	}
	if err != nil {
		s.internalError(w, "delete scheme", err)
		return
	}
	s.audit(r, "permission_scheme.deleted", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

type grantRequest struct {
	Permission  string  `json:"permission"`
	GranteeType string  `json:"granteeType"`
	GranteeID   *string `json:"granteeId"`
}

func (s *Server) handleAdminAddGrant(w http.ResponseWriter, r *http.Request) {
	var req grantRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	fields := map[string]string{}
	if !store.ValidPermission(req.Permission) {
		fields["permission"] = "unknown permission"
	}
	if !store.GranteeTypes[req.GranteeType] {
		fields["granteeType"] = "must be role, user, lead, reporter, assignee or anyone"
	}
	switch req.GranteeType {
	case "role":
		if req.GranteeID == nil || (*req.GranteeID != "admin" && *req.GranteeID != "member" && *req.GranteeID != "viewer") {
			fields["granteeId"] = "role must be admin, member or viewer"
		}
	case "user":
		if req.GranteeID == nil {
			fields["granteeId"] = "user id required"
		} else if _, err := s.store.GetUserByID(r.Context(), *req.GranteeID); err != nil {
			fields["granteeId"] = "no active user with this id"
		}
	default:
		req.GranteeID = nil
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	id := chi.URLParam(r, "id")
	if _, err := s.store.GetPermissionScheme(r.Context(), id); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "scheme not found")
		return
	}
	if err := s.store.AddPermissionGrant(r.Context(), id, req.Permission, req.GranteeType, req.GranteeID); err != nil {
		s.internalError(w, "add grant", err)
		return
	}
	s.audit(r, "permission_scheme.grant_added", req.Permission, map[string]any{"granteeType": req.GranteeType})
	scheme, err := s.store.GetPermissionScheme(r.Context(), id)
	if err != nil {
		s.internalError(w, "get scheme", err)
		return
	}
	writeJSON(w, http.StatusOK, scheme)
}

func (s *Server) handleAdminRemoveGrant(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	err := s.store.RemovePermissionGrant(r.Context(), id, chi.URLParam(r, "grantId"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "grant not found")
		return
	}
	if err != nil {
		s.internalError(w, "remove grant", err)
		return
	}
	s.audit(r, "permission_scheme.grant_removed", chi.URLParam(r, "grantId"), nil)
	scheme, err := s.store.GetPermissionScheme(r.Context(), id)
	if err != nil {
		s.internalError(w, "get scheme", err)
		return
	}
	writeJSON(w, http.StatusOK, scheme)
}

func (s *Server) handleAdminSetProjectScheme(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SchemeID string `json:"schemeId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if _, err := s.store.GetPermissionScheme(r.Context(), req.SchemeID); err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"schemeId": "unknown scheme"})
		return
	}
	key := chi.URLParam(r, "key")
	if err := s.store.SetProjectScheme(r.Context(), key, req.SchemeID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "space not found")
			return
		}
		s.internalError(w, "set project scheme", err)
		return
	}
	s.audit(r, "space.scheme_changed", key, map[string]any{"schemeId": req.SchemeID})
	w.WriteHeader(http.StatusNoContent)
}
