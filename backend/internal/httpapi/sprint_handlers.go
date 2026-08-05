package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// SprintEvent is the payload for sprint.* domain events; the embedded sprint
// flattens so consumers can unmarshal either shape.
type SprintEvent struct {
	store.Sprint
	ProjectKey string `json:"projectKey"`
}

// requireSprint loads the sprint and checks membership of its board's project.
func (s *Server) requireSprint(w http.ResponseWriter, r *http.Request) (store.Sprint, store.Board, string, bool) {
	sprint, err := s.store.GetSprint(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "sprint not found")
		return store.Sprint{}, store.Board{}, "", false
	}
	if err != nil {
		s.internalError(w, "get sprint", err)
		return store.Sprint{}, store.Board{}, "", false
	}
	board, err := s.store.GetBoard(r.Context(), sprint.BoardID)
	if err != nil {
		s.internalError(w, "get board", err)
		return store.Sprint{}, store.Board{}, "", false
	}
	role, err := s.store.MemberRole(r.Context(), board.ProjectID, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusForbidden, "you are not a member of this project")
		return store.Sprint{}, store.Board{}, "", false
	}
	if err != nil {
		s.internalError(w, "member role", err)
		return store.Sprint{}, store.Board{}, "", false
	}
	return sprint, board, role, true
}

func (s *Server) handleListSprints(w http.ResponseWriter, r *http.Request) {
	board, _, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	sprints, err := s.store.ListSprints(r.Context(), board.ID, r.URL.Query().Get("includeClosed") == "true")
	if err != nil {
		s.internalError(w, "list sprints", err)
		return
	}
	writeJSON(w, http.StatusOK, sprints)
}

func (s *Server) handleCreateSprint(w http.ResponseWriter, r *http.Request) {
	board, _, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, board.ProjectID, "manage-sprints", nil) {
		return
	}
	sprint, err := s.store.CreateSprint(r.Context(), board.ID)
	if err != nil {
		s.internalError(w, "create sprint", err)
		return
	}
	s.publish(r, "sprint.created", SprintEvent{Sprint: sprint, ProjectKey: board.ProjectKey})
	writeJSON(w, http.StatusCreated, sprint)
}

// handleBoardBacklog returns unresolved, sprintless issues in rank order.
func (s *Server) handleBoardBacklog(w http.ResponseWriter, r *http.Request) {
	board, _, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	issues, total, err := s.store.ListIssues(r.Context(), board.ProjectID, store.IssueFilter{Backlog: true, MaxResults: 500})
	if err != nil {
		s.internalError(w, "backlog", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "values": issues})
}

// handleSprintIssues returns a sprint's issues in rank order.
func (s *Server) handleSprintIssues(w http.ResponseWriter, r *http.Request) {
	sprint, board, _, ok := s.requireSprint(w, r)
	if !ok {
		return
	}
	issues, total, err := s.store.ListIssues(r.Context(), board.ProjectID, store.IssueFilter{SprintID: sprint.ID, MaxResults: 500})
	if err != nil {
		s.internalError(w, "sprint issues", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "values": issues})
}

type updateSprintRequest struct {
	Name string `json:"name"`
	Goal string `json:"goal"`
}

func (s *Server) handleUpdateSprint(w http.ResponseWriter, r *http.Request) {
	sprint, board, _, ok := s.requireSprint(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, board.ProjectID, "manage-sprints", nil) {
		return
	}
	var req updateSprintRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "sprint name required"})
		return
	}
	updated, err := s.store.UpdateSprint(r.Context(), sprint.ID, req.Name, req.Goal)
	if err != nil {
		s.internalError(w, "update sprint", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteSprint(w http.ResponseWriter, r *http.Request) {
	sprint, board, _, ok := s.requireSprint(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, board.ProjectID, "manage-sprints", nil) {
		return
	}
	if err := s.store.DeleteSprint(r.Context(), sprint.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "only future sprints can be deleted")
			return
		}
		s.internalError(w, "delete sprint", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type startSprintRequest struct {
	Name    string    `json:"name"`
	Goal    string    `json:"goal"`
	StartAt time.Time `json:"startAt"`
	EndAt   time.Time `json:"endAt"`
}

func (s *Server) handleStartSprint(w http.ResponseWriter, r *http.Request) {
	sprint, board, _, ok := s.requireSprint(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, board.ProjectID, "manage-sprints", nil) {
		return
	}
	var req startSprintRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Name == "" {
		req.Name = sprint.Name
	}
	if req.StartAt.IsZero() || req.EndAt.IsZero() || !req.EndAt.After(req.StartAt) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"endAt": "end date must be after start date"})
		return
	}
	started, err := s.store.StartSprint(r.Context(), sprint.ID, req.Name, req.Goal, req.StartAt, req.EndAt)
	if errors.Is(err, store.ErrSprintActive) {
		writeError(w, http.StatusConflict, "another sprint is already active on this board")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "only future sprints can be started")
		return
	}
	if err != nil {
		s.internalError(w, "start sprint", err)
		return
	}
	s.publish(r, "sprint.started", SprintEvent{Sprint: started, ProjectKey: board.ProjectKey})
	writeJSON(w, http.StatusOK, started)
}

type completeSprintRequest struct {
	MoveToSprintID *string `json:"moveToSprintId"`
}

func (s *Server) handleCompleteSprint(w http.ResponseWriter, r *http.Request) {
	sprint, board, _, ok := s.requireSprint(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, board.ProjectID, "manage-sprints", nil) {
		return
	}
	var req completeSprintRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	closed, movedCount, err := s.store.CompleteSprint(r.Context(), sprint.ID, req.MoveToSprintID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "only active sprints can be completed")
		return
	}
	if err != nil {
		s.internalError(w, "complete sprint", err)
		return
	}
	s.publish(r, "sprint.completed", SprintEvent{Sprint: closed, ProjectKey: board.ProjectKey})
	writeJSON(w, http.StatusOK, map[string]any{"sprint": closed, "movedIssues": movedCount})
}

func (s *Server) handleBurndown(w http.ResponseWriter, r *http.Request) {
	sprint, _, _, ok := s.requireSprint(w, r)
	if !ok {
		return
	}
	points, total, err := s.store.Burndown(r.Context(), sprint.ID)
	if err != nil {
		s.internalError(w, "burndown", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sprint": sprint, "total": total, "points": points})
}

func (s *Server) handleListEpics(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	epics, err := s.store.ListEpics(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "list epics", err)
		return
	}
	writeJSON(w, http.StatusOK, epics)
}

func (s *Server) handleIssueChildren(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	children, err := s.store.ListChildren(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "children", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": children})
}
