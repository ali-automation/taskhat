package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage 21: Releases (versions) ----

func (s *Server) handleListVersions(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	versions, err := s.store.ListVersions(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "list versions", err)
		return
	}
	writeJSON(w, http.StatusOK, versions)
}

type versionRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	StartDate   string `json:"startDate"`   // YYYY-MM-DD or ""
	ReleaseDate string `json:"releaseDate"` // YYYY-MM-DD or ""
}

func (v versionRequest) parse(w http.ResponseWriter) (name, desc string, start, release *time.Time, ok bool) {
	fields := map[string]string{}
	name = strings.TrimSpace(v.Name)
	if name == "" || len(name) > 120 {
		fields["name"] = "version name required (max 120 chars)"
	}
	parseDate := func(s, f string) *time.Time {
		if s == "" {
			return nil
		}
		d, err := time.Parse("2006-01-02", s)
		if err != nil {
			fields[f] = "must be YYYY-MM-DD"
			return nil
		}
		return &d
	}
	start = parseDate(v.StartDate, "startDate")
	release = parseDate(v.ReleaseDate, "releaseDate")
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return "", "", nil, nil, false
	}
	return name, strings.TrimSpace(v.Description), start, release, true
}

func (s *Server) handleCreateVersion(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	if !s.requirePerm(w, r, project.ID, "manage-versions", nil) {
		return
	}
	var req versionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name, desc, start, release, ok := req.parse(w)
	if !ok {
		return
	}
	version, err := s.store.CreateVersion(r.Context(), project.ID, name, desc, start, release)
	if errors.Is(err, store.ErrVersionExists) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": err.Error()})
		return
	}
	if err != nil {
		s.internalError(w, "create version", err)
		return
	}
	writeJSON(w, http.StatusCreated, version)
}

// requireVersion loads a version and checks it belongs to the project in the URL.
func (s *Server) requireVersion(w http.ResponseWriter, r *http.Request) (store.Version, store.Project, string, bool) {
	project, role, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return store.Version{}, store.Project{}, "", false
	}
	version, err := s.store.GetVersion(r.Context(), chi.URLParam(r, "versionId"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && version.ProjectID != project.ID) {
		writeError(w, http.StatusNotFound, "version not found")
		return store.Version{}, store.Project{}, "", false
	}
	if err != nil {
		s.internalError(w, "get version", err)
		return store.Version{}, store.Project{}, "", false
	}
	return version, project, role, true
}

func (s *Server) handleGetVersion(w http.ResponseWriter, r *http.Request) {
	version, _, _, ok := s.requireVersion(w, r)
	if !ok {
		return
	}
	issues, err := s.store.VersionIssues(r.Context(), version.ID)
	if err != nil {
		s.internalError(w, "version issues", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "issues": issues})
}

func (s *Server) handleUpdateVersion(w http.ResponseWriter, r *http.Request) {
	version, _, _, ok := s.requireVersion(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, version.ProjectID, "manage-versions", nil) {
		return
	}
	var req versionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name, desc, start, release, ok := req.parse(w)
	if !ok {
		return
	}
	updated, err := s.store.UpdateVersion(r.Context(), version.ID, name, desc, start, release)
	if errors.Is(err, store.ErrVersionExists) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": err.Error()})
		return
	}
	if err != nil {
		s.internalError(w, "update version", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// handleVersionStatus releases, archives, or reopens a version.
func (s *Server) handleVersionStatus(w http.ResponseWriter, r *http.Request) {
	version, _, _, ok := s.requireVersion(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, version.ProjectID, "manage-versions", nil) {
		return
	}
	var req struct {
		Status     string  `json:"status"` // released | unreleased | archived
		MoveOpenTo *string `json:"moveOpenTo"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Status != "released" && req.Status != "unreleased" && req.Status != "archived" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"status": "must be released, unreleased or archived"})
		return
	}
	if req.MoveOpenTo != nil && *req.MoveOpenTo == version.ID {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"moveOpenTo": "pick a different version"})
		return
	}
	updated, err := s.store.SetVersionStatus(r.Context(), version.ID, req.Status, req.MoveOpenTo)
	if err != nil {
		s.internalError(w, "set version status", err)
		return
	}
	s.audit(r, "version."+req.Status, version.Name, nil)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteVersion(w http.ResponseWriter, r *http.Request) {
	version, _, _, ok := s.requireVersion(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, version.ProjectID, "administer", nil) {
		return
	}
	if err := s.store.DeleteVersion(r.Context(), version.ID); err != nil {
		s.internalError(w, "delete version", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
