package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

func (s *Server) handleListBoards(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	boards, err := s.store.ListBoards(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "list boards", err)
		return
	}
	writeJSON(w, http.StatusOK, boards)
}

// requireBoard loads the board and checks membership of its project.
func (s *Server) requireBoard(w http.ResponseWriter, r *http.Request) (store.Board, string, bool) {
	board, err := s.store.GetBoard(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "board not found")
		return store.Board{}, "", false
	}
	if err != nil {
		s.internalError(w, "get board", err)
		return store.Board{}, "", false
	}
	role, err := s.store.MemberRole(r.Context(), board.ProjectID, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusForbidden, "you are not a member of this project")
		return store.Board{}, "", false
	}
	if err != nil {
		s.internalError(w, "member role", err)
		return store.Board{}, "", false
	}
	return board, role, true
}

func (s *Server) handleGetBoard(w http.ResponseWriter, r *http.Request) {
	board, _, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, board)
}

// handleBoardIssues returns the board's issues in rank order; the client
// groups them into columns by status. Scrum boards are scoped to the active
// sprint (empty when none is running), kanban boards show everything.
func (s *Server) handleBoardIssues(w http.ResponseWriter, r *http.Request) {
	board, _, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	filter := store.IssueFilter{MaxResults: 500}
	// Jira's kanban Done column only shows recently finished work; the rest
	// hides behind "See older work items".
	const doneWindowDays = 14
	hiddenDone := 0
	if board.Type == "kanban" {
		filter.MaxResolvedAgeDays = doneWindowDays
		var err error
		if hiddenDone, err = s.store.HiddenDoneCount(r.Context(), board.ProjectID, doneWindowDays); err != nil {
			s.internalError(w, "hidden done", err)
			return
		}
	}
	var activeSprint *store.Sprint
	if board.Type == "scrum" {
		sprints, err := s.store.ListSprints(r.Context(), board.ID, false)
		if err != nil {
			s.internalError(w, "list sprints", err)
			return
		}
		for i := range sprints {
			if sprints[i].State == "active" {
				activeSprint = &sprints[i]
				break
			}
		}
		if activeSprint == nil {
			writeJSON(w, http.StatusOK, map[string]any{"total": 0, "values": []store.Issue{}, "sprint": nil})
			return
		}
		filter.SprintID = activeSprint.ID
	}
	issues, total, err := s.store.ListIssues(r.Context(), board.ProjectID, filter)
	if err != nil {
		s.internalError(w, "board issues", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "values": issues, "sprint": activeSprint, "hiddenDone": hiddenDone})
}

type updateColumnsRequest struct {
	Columns []store.ColumnUpdate `json:"columns"`
}

func (s *Server) handleUpdateColumns(w http.ResponseWriter, r *http.Request) {
	board, _, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, board.ProjectID, "administer", nil) {
		return
	}
	var req updateColumnsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	for _, c := range req.Columns {
		if c.Name == "" {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "column name required"})
			return
		}
	}
	if err := s.store.UpdateColumns(r.Context(), board.ID, req.Columns); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "unknown column id")
			return
		}
		s.internalError(w, "update columns", err)
		return
	}
	updated, err := s.store.GetBoard(r.Context(), board.ID)
	if err != nil {
		s.internalError(w, "get board", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

type rankRequest struct {
	RankBeforeIssue string `json:"rankBeforeIssue"`
	RankAfterIssue  string `json:"rankAfterIssue"`
}

// handleRankIssue re-orders an issue relative to another (drag & drop).
// Reference issues are given by key, mirroring Jira's agile rank API.
func (s *Server) handleRankIssue(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "edit", &issue) {
		return
	}
	var req rankRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if (req.RankBeforeIssue == "") == (req.RankAfterIssue == "") {
		writeError(w, http.StatusBadRequest, "provide exactly one of rankBeforeIssue or rankAfterIssue")
		return
	}

	refKey := req.RankBeforeIssue
	if refKey == "" {
		refKey = req.RankAfterIssue
	}
	projectKey, number, valid := parseIssueKey(refKey)
	if !valid || projectKey != issue.ProjectKey {
		writeError(w, http.StatusBadRequest, "reference issue must be a valid key in the same project")
		return
	}
	ref, err := s.store.GetIssueByKey(r.Context(), projectKey, number)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "reference issue not found")
		return
	}
	if err != nil {
		s.internalError(w, "ref issue", err)
		return
	}

	beforeID, afterID := "", ""
	if req.RankBeforeIssue != "" {
		beforeID = ref.ID
	} else {
		afterID = ref.ID
	}
	if err := s.store.RankIssue(r.Context(), issue.ID, beforeID, afterID); err != nil {
		s.internalError(w, "rank issue", err)
		return
	}
	updated, err := s.store.GetIssueByID(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "get issue", err)
		return
	}
	s.publish(r, "issue.ranked", updated)
	writeJSON(w, http.StatusOK, updated)
}
