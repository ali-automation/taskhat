package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
	"github.com/ali-automation/taskhat/backend/internal/tql"
)

var gadgetTypes = map[string]bool{
	"text": true, "tql_list": true, "pie_chart": true, "burndown": true,
	"workload": true, "activity": true, "quick_links": true,
}

// expandTQL substitutes currentUser() with the caller's email (JQL parity),
// so shared dashboards can carry per-viewer queries like "Assigned to me".
func (s *Server) expandTQL(r *http.Request, tqlText string) string {
	if !strings.Contains(tqlText, "currentUser()") {
		return tqlText
	}
	u, err := s.store.GetUserByID(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		return tqlText
	}
	return strings.ReplaceAll(tqlText, "currentUser()", u.Email)
}

// resolveDashboardID lets routes address the site dashboard as "default".
func (s *Server) resolveDashboardID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if id != "default" {
		return id, true
	}
	resolved, err := s.store.DefaultDashboardID(r.Context())
	if err != nil {
		writeError(w, http.StatusNotFound, "no default dashboard configured")
		return "", false
	}
	return resolved, true
}

// requireDashboardEditor loads the dashboard and verifies the caller may edit
// it: the owner for personal dashboards, any admin for the site dashboard.
func (s *Server) requireDashboardEditor(w http.ResponseWriter, r *http.Request) (store.Dashboard, bool) {
	id, ok := s.resolveDashboardID(w, r)
	if !ok {
		return store.Dashboard{}, false
	}
	d, err := s.store.GetDashboardMeta(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "dashboard not found")
		return store.Dashboard{}, false
	}
	if err != nil {
		s.internalError(w, "load dashboard", err)
		return store.Dashboard{}, false
	}
	if d.Owner == nil {
		isAdmin, err := s.store.IsAdmin(r.Context(), userIDFrom(r.Context()))
		if err != nil {
			s.internalError(w, "admin check", err)
			return store.Dashboard{}, false
		}
		if !isAdmin {
			writeError(w, http.StatusForbidden, "only administrators can edit the default dashboard")
			return store.Dashboard{}, false
		}
	} else if d.Owner.ID != userIDFrom(r.Context()) {
		writeError(w, http.StatusForbidden, "you can only edit your own dashboards")
		return store.Dashboard{}, false
	}
	return d, true
}

func (s *Server) handleListDashboards(w http.ResponseWriter, r *http.Request) {
	dashboards, err := s.store.ListDashboards(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "list dashboards", err)
		return
	}
	writeJSON(w, http.StatusOK, dashboards)
}

type dashboardRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsShared    bool   `json:"isShared"`
}

func validateDashboard(w http.ResponseWriter, req *dashboardRequest) bool {
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "dashboard name required"})
		return false
	}
	return true
}

func (s *Server) handleCreateDashboard(w http.ResponseWriter, r *http.Request) {
	var req dashboardRequest
	if !decodeJSON(w, r, &req) || !validateDashboard(w, &req) {
		return
	}
	d, err := s.store.CreateDashboard(r.Context(), userIDFrom(r.Context()), req.Name, req.Description, req.IsShared)
	if errors.Is(err, store.ErrDashboardNameTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "you already have a dashboard with this name"})
		return
	}
	if err != nil {
		s.internalError(w, "create dashboard", err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) handleGetDashboard(w http.ResponseWriter, r *http.Request) {
	id, ok := s.resolveDashboardID(w, r)
	if !ok {
		return
	}
	d, err := s.store.GetDashboard(r.Context(), id, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "dashboard not found")
		return
	}
	if err != nil {
		s.internalError(w, "get dashboard", err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleUpdateDashboard(w http.ResponseWriter, r *http.Request) {
	d, ok := s.requireDashboardEditor(w, r)
	if !ok {
		return
	}
	var req dashboardRequest
	if !decodeJSON(w, r, &req) || !validateDashboard(w, &req) {
		return
	}
	if d.IsDefault {
		req.IsShared = true // the site dashboard stays visible to everyone
	}
	err := s.store.UpdateDashboard(r.Context(), d.ID, req.Name, req.Description, req.IsShared)
	if errors.Is(err, store.ErrDashboardNameTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "you already have a dashboard with this name"})
		return
	}
	if err != nil {
		s.internalError(w, "update dashboard", err)
		return
	}
	updated, err := s.store.GetDashboard(r.Context(), d.ID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "reload dashboard", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteDashboard(w http.ResponseWriter, r *http.Request) {
	d, ok := s.requireDashboardEditor(w, r)
	if !ok {
		return
	}
	if d.IsDefault {
		writeError(w, http.StatusBadRequest, "the default dashboard cannot be deleted")
		return
	}
	if err := s.store.DeleteDashboard(r.Context(), d.ID); err != nil {
		s.internalError(w, "delete dashboard", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type gadgetRequest struct {
	Type   string          `json:"type"`
	Title  string          `json:"title"`
	Config json.RawMessage `json:"config"`
}

func (s *Server) validateGadget(w http.ResponseWriter, r *http.Request, req *gadgetRequest) bool {
	req.Title = strings.TrimSpace(req.Title)
	fields := map[string]string{}
	if req.Title == "" {
		fields["title"] = "gadget title required"
	}
	if len(req.Config) == 0 {
		req.Config = json.RawMessage(`{}`)
	}
	var cfg struct {
		TQL string `json:"tql"`
	}
	if err := json.Unmarshal(req.Config, &cfg); err != nil {
		fields["config"] = "config must be a JSON object"
	} else if cfg.TQL != "" {
		if _, err := tql.ParseWith(s.expandTQL(r, cfg.TQL), s.cfResolver(r)); err != nil {
			fields["tql"] = err.Error()
		}
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return false
	}
	return true
}

func (s *Server) handleAddGadget(w http.ResponseWriter, r *http.Request) {
	d, ok := s.requireDashboardEditor(w, r)
	if !ok {
		return
	}
	var req gadgetRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !gadgetTypes[req.Type] {
		writeError(w, http.StatusBadRequest, "unknown gadget type")
		return
	}
	if !s.validateGadget(w, r, &req) {
		return
	}
	g, err := s.store.AddGadget(r.Context(), d.ID, req.Type, req.Title, req.Config)
	if err != nil {
		s.internalError(w, "add gadget", err)
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (s *Server) handleUpdateGadget(w http.ResponseWriter, r *http.Request) {
	d, ok := s.requireDashboardEditor(w, r)
	if !ok {
		return
	}
	var req gadgetRequest
	if !decodeJSON(w, r, &req) || !s.validateGadget(w, r, &req) {
		return
	}
	err := s.store.UpdateGadget(r.Context(), d.ID, chi.URLParam(r, "gadgetId"), req.Title, req.Config)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "gadget not found")
		return
	}
	if err != nil {
		s.internalError(w, "update gadget", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteGadget(w http.ResponseWriter, r *http.Request) {
	d, ok := s.requireDashboardEditor(w, r)
	if !ok {
		return
	}
	err := s.store.DeleteGadget(r.Context(), d.ID, chi.URLParam(r, "gadgetId"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "gadget not found")
		return
	}
	if err != nil {
		s.internalError(w, "delete gadget", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSaveLayout(w http.ResponseWriter, r *http.Request) {
	d, ok := s.requireDashboardEditor(w, r)
	if !ok {
		return
	}
	var layout []store.GadgetPlacement
	if !decodeJSON(w, r, &layout) {
		return
	}
	if err := s.store.SaveGadgetLayout(r.Context(), d.ID, layout); err != nil {
		s.internalError(w, "save layout", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleGadgetPie groups TQL results for the pie chart gadget.
func (s *Server) handleGadgetPie(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query, err := tql.ParseWith(s.expandTQL(r, q.Get("tql")), s.cfResolver(r))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	slices, err := s.store.PieCounts(r.Context(), userIDFrom(r.Context()), query.Where, query.Args, q.Get("by"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": slices})
}

// handleGadgetActivity streams recent events across the caller's spaces.
func (s *Server) handleGadgetActivity(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r.URL.Query().Get("limit"), 15)
	if limit > 50 {
		limit = 50
	}
	projectKey := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("project")))
	entries, err := s.store.RecentActivity(r.Context(), userIDFrom(r.Context()), projectKey, limit)
	if err != nil {
		s.internalError(w, "gadget activity", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": entries})
}

// handleGadgetBurndown resolves a space's active sprint for the burndown gadget.
func (s *Server) handleGadgetBurndown(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, r.URL.Query().Get("project"))
	if !ok {
		return
	}
	sprint, err := s.store.ActiveSprint(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "active sprint", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sprint": sprint})
}
