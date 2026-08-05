package httpapi

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func reportDays(r *http.Request) int {
	d, err := strconv.Atoi(r.URL.Query().Get("days"))
	if err != nil || d < 7 {
		return 30
	}
	if d > 730 {
		return 730
	}
	return d
}

func (s *Server) handleReportOverview(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	o, err := s.store.ReportOverview(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "report overview", err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (s *Server) handleReportCFD(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	days, err := s.store.ReportCumulativeFlow(r.Context(), project.ID, reportDays(r))
	if err != nil {
		s.internalError(w, "report cfd", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"days": days})
}

func (s *Server) handleReportCycleTime(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	points, err := s.store.ReportCycleTime(r.Context(), project.ID, reportDays(r))
	if err != nil {
		s.internalError(w, "report cycle time", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"points": points})
}

func (s *Server) handleReportTrend(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	days := reportDays(r)
	var (
		buckets any
		iv      string
		err     error
	)
	switch chi.URLParam(r, "trend") {
	case "created-vs-resolved":
		buckets, iv, err = s.store.ReportCreatedVsResolved(r.Context(), project.ID, days)
	case "recently-created":
		buckets, iv, err = s.store.ReportRecentlyCreated(r.Context(), project.ID, days)
	case "resolution-time":
		buckets, iv, err = s.store.ReportResolutionTime(r.Context(), project.ID, days)
	case "average-age":
		buckets, iv, err = s.store.ReportAverageAge(r.Context(), project.ID, days)
	case "time-since":
		field := r.URL.Query().Get("field")
		if field == "" {
			field = "created"
		}
		buckets, iv, err = s.store.ReportTimeSince(r.Context(), project.ID, field, days)
	default:
		writeError(w, http.StatusNotFound, "unknown report")
		return
	}
	if err != nil {
		s.internalError(w, "report trend", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"interval": iv, "buckets": buckets})
}

func (s *Server) handleReportPie(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	field := r.URL.Query().Get("field")
	if field == "" {
		field = "assignee"
	}
	slices, err := s.store.ReportSlicesByField(r.Context(), project.ID, field)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"slices": slices})
}

func (s *Server) handleReportGroupBy(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	field := r.URL.Query().Get("field")
	if field == "" {
		field = "assignee"
	}
	groups, err := s.store.ReportGroupBy(r.Context(), project.ID, field)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (s *Server) handleReportWorkload(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	slices, err := s.store.ReportWorkload(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "report workload", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"slices": slices})
}
