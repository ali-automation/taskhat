package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
	"github.com/ali-automation/taskhat/backend/internal/tql"
)

// cfResolver lets TQL resolve cf["Field name"] references against the DB.
func (s *Server) cfResolver(r *http.Request) tql.CustomFieldResolver {
	return func(name string) []string {
		ids, err := s.store.CustomFieldIDsByName(r.Context(), name)
		if err != nil {
			s.log.Error("resolve custom field", "name", name, "error", err)
			return nil
		}
		return ids
	}
}

// handleSearch runs a TQL query, scoped to the caller's projects.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query, err := tql.ParseWith(s.expandTQL(r, q.Get("tql")), s.cfResolver(r))
	var parseErr *tql.ParseError
	if errors.As(err, &parseErr) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"tql": parseErr.Error()})
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	startAt := intParam(q.Get("startAt"), 0)
	maxResults := intParam(q.Get("maxResults"), 50)
	if maxResults > 100 {
		maxResults = 100
	}
	issues, total, err := s.store.SearchIssues(r.Context(), userIDFrom(r.Context()),
		query.Where, query.Args, query.OrderBy, startAt, maxResults)
	if err != nil {
		s.internalError(w, "search", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"startAt":    startAt,
		"maxResults": maxResults,
		"total":      total,
		"isLast":     startAt+len(issues) >= total,
		"values":     issues,
	})
}

func (s *Server) handleQuickSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	spaceKey := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("space")))
	contributor := strings.TrimSpace(r.URL.Query().Get("contributor"))
	if q == "" {
		// Confluence's empty search: your recently viewed pages, drafts marked.
		recent, err := s.store.RecentViewedWikiPages(r.Context(), userIDFrom(r.Context()), 9)
		if err != nil {
			s.log.Error("recent viewed", "error", err)
			recent = nil
		}
		writeJSON(w, http.StatusOK, map[string]any{"values": []store.Issue{}, "recentWiki": recent})
		return
	}
	issues, err := s.store.QuickSearch(r.Context(), userIDFrom(r.Context()), q, 10)
	if err != nil {
		s.internalError(w, "quick search", err)
		return
	}
	// DocHat pages ride along in the same dropdown, like Confluence's search.
	limit := 5
	if spaceKey != "" || contributor != "" {
		limit = 10
	}
	pages, err := s.store.WikiQuickSearch(r.Context(), userIDFrom(r.Context()), q, spaceKey, contributor, limit)
	if err != nil {
		s.log.Error("wiki quick search", "error", err)
		pages = nil
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": issues, "wikiPages": pages})
}

func (s *Server) handleListFilters(w http.ResponseWriter, r *http.Request) {
	filters, err := s.store.ListFilters(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "list filters", err)
		return
	}
	writeJSON(w, http.StatusOK, filters)
}

type filterRequest struct {
	Name     string `json:"name"`
	TQL      string `json:"tql"`
	IsShared bool   `json:"isShared"`
}

func (s *Server) validateFilter(w http.ResponseWriter, r *http.Request, req *filterRequest) bool {
	req.Name = strings.TrimSpace(req.Name)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "filter name required"
	}
	if _, err := tql.ParseWith(s.expandTQL(r, req.TQL), s.cfResolver(r)); err != nil {
		fields["tql"] = err.Error()
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return false
	}
	return true
}

func (s *Server) handleCreateFilter(w http.ResponseWriter, r *http.Request) {
	var req filterRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !s.validateFilter(w, r, &req) {
		return
	}
	filter, err := s.store.CreateFilter(r.Context(), userIDFrom(r.Context()), req.Name, req.TQL, req.IsShared)
	if errors.Is(err, store.ErrFilterNameTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "you already have a filter with this name"})
		return
	}
	if err != nil {
		s.internalError(w, "create filter", err)
		return
	}
	writeJSON(w, http.StatusCreated, filter)
}

func (s *Server) handleUpdateFilter(w http.ResponseWriter, r *http.Request) {
	var req filterRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !s.validateFilter(w, r, &req) {
		return
	}
	filter, err := s.store.UpdateFilter(r.Context(), chi.URLParam(r, "id"), userIDFrom(r.Context()),
		req.Name, req.TQL, req.IsShared)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "filter not found (you can only edit your own filters)")
		return
	}
	if errors.Is(err, store.ErrFilterNameTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "you already have a filter with this name"})
		return
	}
	if err != nil {
		s.internalError(w, "update filter", err)
		return
	}
	writeJSON(w, http.StatusOK, filter)
}

func (s *Server) handleDeleteFilter(w http.ResponseWriter, r *http.Request) {
	err := s.store.DeleteFilter(r.Context(), chi.URLParam(r, "id"), userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "filter not found (you can only delete your own filters)")
		return
	}
	if err != nil {
		s.internalError(w, "delete filter", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleProjectSummary(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	summary, err := s.store.GetProjectSummary(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "project summary", err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}
