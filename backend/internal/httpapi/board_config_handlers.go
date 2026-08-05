package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// Board management (Jira parity): sidebar + creates extra boards, board ⋯
// offers settings + delete, and stars power the Starred section.

func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "board name required"})
		return
	}
	if req.Type != "kanban" && req.Type != "scrum" {
		writeError(w, http.StatusBadRequest, "board type must be kanban or scrum")
		return
	}
	board, err := s.store.CreateBoard(r.Context(), project.ID, req.Name, req.Type)
	if err != nil {
		s.internalError(w, "create board", err)
		return
	}
	writeJSON(w, http.StatusCreated, board)
}

func (s *Server) handleRenameBoard(w http.ResponseWriter, r *http.Request) {
	board, role, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	if role != "admin" {
		writeError(w, http.StatusForbidden, "space admin access required")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "board name required"})
		return
	}
	if err := s.store.RenameBoard(r.Context(), board.ID, req.Name); err != nil {
		s.internalError(w, "rename board", err)
		return
	}
	updated, err := s.store.GetBoard(r.Context(), board.ID)
	if err != nil {
		s.internalError(w, "get board", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	board, role, ok := s.requireBoard(w, r)
	if !ok {
		return
	}
	if role != "admin" {
		writeError(w, http.StatusForbidden, "space admin access required")
		return
	}
	err := s.store.DeleteBoard(r.Context(), board.ID)
	if errors.Is(err, store.ErrLastBoard) {
		writeError(w, http.StatusBadRequest, "a space needs at least one board")
		return
	}
	if err != nil {
		s.internalError(w, "delete board", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- stars ----

func (s *Server) handleListStars(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListStars(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "list stars", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": items})
}

func (s *Server) handleSetStar(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind     string `json:"kind"`
		TargetID string `json:"targetId"`
		Starred  bool   `json:"starred"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	err := s.store.SetStar(r.Context(), userIDFrom(r.Context()), req.Kind, req.TargetID, req.Starred)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
