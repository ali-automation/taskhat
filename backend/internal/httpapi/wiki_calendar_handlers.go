package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage W14: team calendars ----

type calendarEventRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	StartDate   string `json:"startDate"` // YYYY-MM-DD
	EndDate     string `json:"endDate"`
	Color       string `json:"color"`
}

func (req *calendarEventRequest) parse(w http.ResponseWriter) (title string, start, end time.Time, ok bool) {
	fields := map[string]string{}
	title = strings.TrimSpace(req.Title)
	if title == "" {
		fields["title"] = "event title required"
	}
	var err error
	start, err = time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		fields["startDate"] = "must be YYYY-MM-DD"
	}
	if req.EndDate == "" {
		end = start
	} else if end, err = time.Parse("2006-01-02", req.EndDate); err != nil {
		fields["endDate"] = "must be YYYY-MM-DD"
	}
	if err == nil && end.Before(start) {
		fields["endDate"] = "must not be before the start date"
	}
	if req.Color == "" {
		req.Color = "blue"
	}
	if !store.CalendarColors[req.Color] {
		fields["color"] = "unknown color"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return "", time.Time{}, time.Time{}, false
	}
	return title, start, end, true
}

// handleWikiCalendar returns the month's events plus the TaskHat feed
// (due work items and sprint starts/ends scoped to the caller's projects).
func (s *Server) handleWikiCalendar(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	from, err1 := time.Parse("2006-01-02", r.URL.Query().Get("from"))
	to, err2 := time.Parse("2006-01-02", r.URL.Query().Get("to"))
	if err1 != nil || err2 != nil || to.Before(from) || to.Sub(from) > 70*24*time.Hour {
		writeError(w, http.StatusBadRequest, "from/to must be YYYY-MM-DD spanning at most 10 weeks")
		return
	}
	events, err := s.store.ListWikiCalendarEvents(r.Context(), space.ID, from, to)
	if err != nil {
		s.internalError(w, "calendar events", err)
		return
	}
	userID := userIDFrom(r.Context())
	due, err := s.store.CalendarDueItems(r.Context(), userID, from, to)
	if err != nil {
		s.internalError(w, "calendar due items", err)
		return
	}
	sprints, err := s.store.CalendarSprints(r.Context(), userID, from, to)
	if err != nil {
		s.internalError(w, "calendar sprints", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events, "dueItems": due, "sprints": sprints})
}

func (s *Server) handleCreateWikiCalendarEvent(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "collaborator")
	if !ok {
		return
	}
	var req calendarEventRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	title, start, end, ok := req.parse(w)
	if !ok {
		return
	}
	id, err := s.store.CreateWikiCalendarEvent(r.Context(), space.ID, title,
		strings.TrimSpace(req.Description), start, end, req.Color, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create calendar event", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// requireCalendarEvent gates event mutations at collaborator level.
func (s *Server) requireCalendarEvent(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	spaceID, err := s.store.WikiCalendarEventSpace(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "event not found")
		return "", false
	}
	if err != nil {
		s.internalError(w, "calendar event", err)
		return "", false
	}
	if _, ok := s.requireWikiSpaceRole(w, r, spaceID, "collaborator"); !ok {
		return "", false
	}
	return id, true
}

func (s *Server) handleUpdateWikiCalendarEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireCalendarEvent(w, r)
	if !ok {
		return
	}
	var req calendarEventRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	title, start, end, ok := req.parse(w)
	if !ok {
		return
	}
	if err := s.store.UpdateWikiCalendarEvent(r.Context(), id, title,
		strings.TrimSpace(req.Description), start, end, req.Color); err != nil {
		s.internalError(w, "update calendar event", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteWikiCalendarEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireCalendarEvent(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteWikiCalendarEvent(r.Context(), id); err != nil {
		s.internalError(w, "delete calendar event", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
