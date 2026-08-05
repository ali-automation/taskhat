package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// LinkEvent flattens the context issue so existing consumers parse it as an
// issue; link details drive automation smart values and webhook payloads.
type LinkEvent struct {
	store.Issue
	LinkType string `json:"linkType"`
	OtherKey string `json:"otherKey"`
}

func (s *Server) handleListLinks(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	links, err := s.store.ListIssueLinks(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "list links", err)
		return
	}
	writeJSON(w, http.StatusOK, links)
}

type createLinkRequest struct {
	LinkType  string `json:"linkType"`  // blocks | relates | duplicates
	Direction string `json:"direction"` // outward (this → other) | inward (other → this)
	OtherKey  string `json:"otherKey"`
}

func (s *Server) handleCreateLink(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "link", &issue) {
		return
	}
	var req createLinkRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if _, ok := store.LinkTypeNames[req.LinkType]; !ok {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"linkType": "must be blocks, relates or duplicates"})
		return
	}
	pk, num, keyOK := parseIssueKey(strings.TrimSpace(req.OtherKey))
	if !keyOK {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"otherKey": "valid work item key required"})
		return
	}
	other, err := s.store.GetIssueByKey(r.Context(), pk, num)
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"otherKey": "work item not found"})
		return
	}
	if err != nil {
		s.internalError(w, "link target", err)
		return
	}
	// The caller must be a member of the other item's space too.
	if _, err := s.store.MemberRole(r.Context(), other.ProjectID, userIDFrom(r.Context())); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusForbidden, "you are not a member of "+other.ProjectKey)
		return
	}

	fromID, toID := issue.ID, other.ID
	if req.Direction == "inward" {
		fromID, toID = other.ID, issue.ID
	}
	if _, err := s.store.CreateLink(r.Context(), fromID, toID, req.LinkType, userIDFrom(r.Context())); err != nil {
		switch {
		case errors.Is(err, store.ErrSelfLink):
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"otherKey": "a work item cannot link to itself"})
		case errors.Is(err, store.ErrLinkExists):
			writeFieldErrors(w, http.StatusConflict, map[string]string{"otherKey": "these work items are already linked this way"})
		default:
			s.internalError(w, "create link", err)
		}
		return
	}
	s.publish(r, "issue.linked", LinkEvent{Issue: issue, LinkType: req.LinkType, OtherKey: other.Key})
	links, err := s.store.ListIssueLinks(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "list links", err)
		return
	}
	writeJSON(w, http.StatusCreated, links)
}

func (s *Server) handleDeleteLink(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "link", &issue) {
		return
	}
	otherID, linkType, err := s.store.DeleteLink(r.Context(), issue.ID, chi.URLParam(r, "linkId"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "link not found")
		return
	}
	if err != nil {
		s.internalError(w, "delete link", err)
		return
	}
	otherKey := ""
	if other, err := s.store.GetIssueByID(r.Context(), otherID); err == nil {
		otherKey = other.Key
	}
	s.publish(r, "issue.link_deleted", LinkEvent{Issue: issue, LinkType: linkType, OtherKey: otherKey})
	w.WriteHeader(http.StatusNoContent)
}
