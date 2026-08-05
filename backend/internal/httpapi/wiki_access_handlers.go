package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/mailer"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage W4: restrictions, share, labels, wiki quick search ----

// requireWikiView gates a page (restrictions inherit from ancestors).
func (s *Server) requireWikiView(w http.ResponseWriter, r *http.Request, pageID string) bool {
	ok, err := s.store.CanViewWikiPage(r.Context(), pageID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "wiki view check", err)
		return false
	}
	if !ok {
		writeError(w, http.StatusForbidden, "this page is restricted")
		return false
	}
	return true
}

func (s *Server) handleWikiListRestrictions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	users, err := s.store.ListWikiRestrictions(r.Context(), id)
	if err != nil {
		s.internalError(w, "wiki restrictions", err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

// handleWikiSetRestrictions replaces the restriction list; an empty list makes
// the page open to everyone again. The caller is always kept on the list.
func (s *Server) handleWikiSetRestrictions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	var req struct {
		UserIDs []string `json:"userIds"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.SetWikiRestrictions(r.Context(), id, req.UserIDs, userIDFrom(r.Context())); err != nil {
		s.internalError(w, "set wiki restrictions", err)
		return
	}
	users, err := s.store.ListWikiRestrictions(r.Context(), id)
	if err != nil {
		s.internalError(w, "wiki restrictions", err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

// handleWikiShare notifies users about a page (and grants access when the
// page is restricted), like Confluence's Share dialog.
func (s *Server) handleWikiShare(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	page, err := s.store.GetWikiPage(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		s.internalError(w, "get wiki page", err)
		return
	}
	var req struct {
		UserIDs []string `json:"userIds"`
		Message string   `json:"message"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.UserIDs) == 0 {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"userIds": "pick at least one person"})
		return
	}
	actorID := userIDFrom(r.Context())
	actor, _ := s.store.GetUserByID(r.Context(), actorID)
	smtp := s.smtpConfig(r)
	link := fmt.Sprintf("%s/wiki/spaces/%s/pages/%s", s.cfg.BaseURL, page.SpaceKey, page.ID)

	payload := map[string]string{
		"summary": page.Title, "preview": strings.TrimSpace(req.Message),
		"wikiPageId": page.ID, "spaceKey": page.SpaceKey,
	}
	for _, uid := range dedupe(req.UserIDs) {
		if uid == actorID {
			continue
		}
		if err := s.store.GrantWikiView(r.Context(), page.ID, uid); err != nil {
			s.log.Error("share grant", "user", uid, "error", err)
		}
		if err := s.store.CreateWikiNotification(r.Context(), uid, actorID, "shared", payload); err != nil {
			s.log.Error("share notification", "user", uid, "error", err)
			continue
		}
		if s.hub != nil {
			_ = s.hub.Publish(r.Context(), "user:"+uid, "notification.new",
				map[string]any{"kind": "shared", "wikiPageId": page.ID})
		}
		if smtp.Enabled() {
			if user, err := s.store.GetUserByID(r.Context(), uid); err == nil {
				subject := fmt.Sprintf("[DocHat] %s shared \"%s\" with you", actor.DisplayName, page.Title)
				body := fmt.Sprintf("%s shared a page with you: %s\r\n\r\n%s\r\n\r\nView it: %s\r\n",
					actor.DisplayName, page.Title, strings.TrimSpace(req.Message), link)
				if err := mailer.Send(smtp, user.Email, subject, body); err != nil {
					s.log.Error("share email", "to", user.Email, "error", err)
				}
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- labels ----

func (s *Server) handleWikiPageLabels(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiView(w, r, id) {
		return
	}
	labels, err := s.store.WikiPageLabels(r.Context(), id)
	if err != nil {
		s.internalError(w, "wiki labels", err)
		return
	}
	writeJSON(w, http.StatusOK, labels)
}

var wikiLabelRe = strings.NewReplacer(" ", "-", "\t", "-")

func (s *Server) handleWikiSetLabels(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	var req struct {
		Labels []string `json:"labels"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	clean := []string{}
	for _, l := range req.Labels {
		l = strings.ToLower(wikiLabelRe.Replace(strings.TrimSpace(l)))
		if l != "" && len(l) <= 60 {
			clean = append(clean, l)
		}
	}
	if err := s.store.SetWikiPageLabels(r.Context(), id, dedupe(clean)); err != nil {
		s.internalError(w, "set wiki labels", err)
		return
	}
	labels, err := s.store.WikiPageLabels(r.Context(), id)
	if err != nil {
		s.internalError(w, "wiki labels", err)
		return
	}
	writeJSON(w, http.StatusOK, labels)
}

// handleWikiPagesByLabel lists a space's pages carrying a label, minus ones
// the caller cannot view.
func (s *Server) handleWikiPagesByLabel(w http.ResponseWriter, r *http.Request) {
	space, err := s.store.GetWikiSpace(r.Context(), strings.ToUpper(chi.URLParam(r, "key")))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "wiki space not found")
		return
	}
	if err != nil {
		s.internalError(w, "get wiki space", err)
		return
	}
	nodes, err := s.store.WikiPagesByLabel(r.Context(), space.ID, strings.ToLower(chi.URLParam(r, "label")))
	if err != nil {
		s.internalError(w, "wiki pages by label", err)
		return
	}
	nodes, err = s.filterWikiNodes(r, space.ID, nodes)
	if err != nil {
		s.internalError(w, "filter wiki nodes", err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

// filterWikiNodes drops nodes hidden from the caller by restriction
// inheritance. Cheap when nothing in the space is restricted.
func (s *Server) filterWikiNodes(r *http.Request, spaceID string, nodes []store.WikiPageNode) ([]store.WikiPageNode, error) {
	userID := userIDFrom(r.Context())
	blocked, err := s.store.WikiRestrictedPages(r.Context(), spaceID, userID)
	if err != nil {
		return nil, err
	}
	if len(blocked) == 0 {
		return nodes, nil
	}
	if isAdmin, err := s.store.IsAdmin(r.Context(), userID); err == nil && isAdmin {
		return nodes, nil
	}
	// Ancestors may not be part of `nodes` (label listings), so walk parents
	// through the full space tree.
	tree, err := s.store.WikiPageTree(r.Context(), spaceID)
	if err != nil {
		return nil, err
	}
	parent := map[string]*string{}
	for _, n := range tree {
		parent[n.ID] = n.ParentID
	}
	memo := map[string]bool{} // hidden?
	var hidden func(id string) bool
	hidden = func(id string) bool {
		if v, ok := memo[id]; ok {
			return v
		}
		memo[id] = false // break cycles defensively
		h := blocked[id]
		if !h {
			if p, ok := parent[id]; ok && p != nil {
				h = hidden(*p)
			}
		}
		memo[id] = h
		return h
	}
	out := []store.WikiPageNode{}
	for _, n := range nodes {
		if !hidden(n.ID) {
			out = append(out, n)
		}
	}
	return out, nil
}

// handleMentionedOn lists wiki pages that reference a work item via chips.
func (s *Server) handleMentionedOn(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	pages, err := s.store.MentionedOnPages(r.Context(), issue.ID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "mentioned on", err)
		return
	}
	writeJSON(w, http.StatusOK, pages)
}
