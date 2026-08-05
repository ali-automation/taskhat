package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage 22: worklogs ----

func (s *Server) handleListWorklogs(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	logs, err := s.store.ListWorklogs(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "list worklogs", err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

type worklogRequest struct {
	TimeSpent    string `json:"timeSpent"` // "2h 30m"
	StartedAt    string `json:"startedAt"` // RFC3339 or YYYY-MM-DD; empty = now
	Comment      string `json:"comment"`
	Adjust       string `json:"adjust"`       // auto (default) | leave | set
	NewRemaining string `json:"newRemaining"` // with adjust=set
}

func (req worklogRequest) parse(w http.ResponseWriter) (seconds int64, started time.Time, comment, adjust string, newRemaining *int64, ok bool) {
	fields := map[string]string{}
	seconds, err := parseJiraDuration(req.TimeSpent)
	if err != nil {
		fields["timeSpent"] = err.Error()
	}
	started = time.Now().UTC()
	if s := strings.TrimSpace(req.StartedAt); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			started = t
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			started = t
		} else {
			fields["startedAt"] = "must be YYYY-MM-DD or RFC3339"
		}
	}
	adjust = req.Adjust
	if adjust == "" {
		adjust = "auto"
	}
	if adjust != "auto" && adjust != "leave" && adjust != "set" {
		fields["adjust"] = "must be auto, leave or set"
	}
	if adjust == "set" {
		n, err := parseJiraDuration(req.NewRemaining)
		if err != nil && strings.TrimSpace(req.NewRemaining) != "0" {
			fields["newRemaining"] = err.Error()
		} else {
			newRemaining = &n
		}
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return 0, time.Time{}, "", "", nil, false
	}
	return seconds, started, strings.TrimSpace(req.Comment), adjust, newRemaining, true
}

func (s *Server) handleAddWorklog(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "log-work", &issue) {
		return
	}
	var req worklogRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	seconds, started, comment, adjust, newRemaining, ok := req.parse(w)
	if !ok {
		return
	}
	wl, err := s.store.AddWorklog(r.Context(), issue.ID, userIDFrom(r.Context()), seconds, started, comment, adjust, newRemaining)
	if err != nil {
		s.internalError(w, "add worklog", err)
		return
	}
	// One history row per log, Jira style ("Time Spent" totals).
	s.store.RecordFieldChanges(r.Context(), issue.ID, userIDFrom(r.Context()), []store.FieldChange{{
		FieldName: "timeSpent",
		Old:       formatJiraDuration(issue.TimeSpentSeconds),
		New:       formatJiraDuration(issue.TimeSpentSeconds + seconds),
	}})
	if updated, err := s.store.GetIssueByID(r.Context(), issue.ID); err == nil {
		s.publish(r, "issue.updated", updated)
	}
	writeJSON(w, http.StatusCreated, wl)
}

func (s *Server) handleUpdateWorklog(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "log-work", &issue) {
		return
	}
	var req worklogRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	seconds, started, comment, _, _, ok := req.parse(w)
	if !ok {
		return
	}
	wl, err := s.store.UpdateWorklog(r.Context(), chi.URLParam(r, "worklogId"), userIDFrom(r.Context()), seconds, started, comment)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "worklog not found (you can only edit your own)")
		return
	}
	if err != nil {
		s.internalError(w, "update worklog", err)
		return
	}
	writeJSON(w, http.StatusOK, wl)
}

func (s *Server) handleDeleteWorklog(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "log-work", &issue) {
		return
	}
	canAll, _ := s.hasPerm(r, issue.ProjectID, "administer", nil)
	err := s.store.DeleteWorklog(r.Context(), chi.URLParam(r, "worklogId"), userIDFrom(r.Context()), canAll)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "worklog not found (you can only delete your own)")
		return
	}
	if err != nil {
		s.internalError(w, "delete worklog", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
