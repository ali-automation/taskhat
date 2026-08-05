package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- personal API tokens ----

func (s *Server) handleListAPITokens(w http.ResponseWriter, r *http.Request) {
	tokens, err := s.store.ListAPITokens(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "list tokens", err)
		return
	}
	writeJSON(w, http.StatusOK, tokens)
}

type createTokenRequest struct {
	Label string `json:"label"`
}

func (s *Server) handleCreateAPIToken(w http.ResponseWriter, r *http.Request) {
	var req createTokenRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Label = strings.TrimSpace(req.Label)
	if req.Label == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"label": "give the token a label (e.g. CI)"})
		return
	}
	tok, plaintext, err := s.store.CreateAPIToken(r.Context(), userIDFrom(r.Context()), req.Label)
	if err != nil {
		s.internalError(w, "create token", err)
		return
	}
	s.audit(r, "api_token.created", req.Label, nil)
	writeJSON(w, http.StatusCreated, map[string]any{"token": plaintext, "info": tok})
}

func (s *Server) handleRevokeAPIToken(w http.ResponseWriter, r *http.Request) {
	if err := s.store.RevokeAPIToken(r.Context(), userIDFrom(r.Context()), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "token not found")
			return
		}
		s.internalError(w, "revoke token", err)
		return
	}
	s.audit(r, "api_token.revoked", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

// ---- admin webhooks ----

var webhookEvents = map[string]bool{
	"*": true, "issue.created": true, "issue.updated": true, "issue.transitioned": true,
	"issue.deleted": true, "comment.added": true, "project.created": true,
	"sprint.created": true, "sprint.started": true, "sprint.completed": true,
	"issue.linked": true, "issue.link_deleted": true,
}

type webhookRequest struct {
	Name       string   `json:"name"`
	URL        string   `json:"url"`
	Secret     *string  `json:"secret"` // nil = keep existing (update only)
	Events     []string `json:"events"`
	ProjectKey *string  `json:"projectKey"` // nil/empty = all spaces
	IsEnabled  *bool    `json:"isEnabled"`
}

func (s *Server) validateWebhook(w http.ResponseWriter, r *http.Request, req *webhookRequest) (projectID *string, ok bool) {
	req.Name = strings.TrimSpace(req.Name)
	req.URL = strings.TrimSpace(req.URL)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "name required"
	}
	if u, err := url.Parse(req.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		fields["url"] = "must be an http(s) URL"
	}
	if len(req.Events) == 0 {
		req.Events = []string{"*"}
	}
	for _, e := range req.Events {
		if !webhookEvents[e] {
			fields["events"] = "unknown event " + e
			break
		}
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return nil, false
	}
	if req.ProjectKey != nil && *req.ProjectKey != "" {
		project, err := s.store.GetProjectByKey(r.Context(), strings.ToUpper(*req.ProjectKey))
		if errors.Is(err, store.ErrNotFound) {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"projectKey": "space not found"})
			return nil, false
		}
		if err != nil {
			s.internalError(w, "project lookup", err)
			return nil, false
		}
		projectID = &project.ID
	}
	return projectID, true
}

func (s *Server) handleAdminListWebhooks(w http.ResponseWriter, r *http.Request) {
	hooks, err := s.store.ListWebhooks(r.Context())
	if err != nil {
		s.internalError(w, "webhooks", err)
		return
	}
	writeJSON(w, http.StatusOK, hooks)
}

func (s *Server) handleAdminCreateWebhook(w http.ResponseWriter, r *http.Request) {
	var req webhookRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	projectID, ok := s.validateWebhook(w, r, &req)
	if !ok {
		return
	}
	secret := ""
	if req.Secret != nil {
		secret = *req.Secret
	}
	hook, err := s.store.CreateWebhook(r.Context(), req.Name, req.URL, secret, req.Events, projectID, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create webhook", err)
		return
	}
	s.audit(r, "webhook.created", req.Name, map[string]any{"url": req.URL})
	writeJSON(w, http.StatusCreated, hook)
}

func (s *Server) handleAdminUpdateWebhook(w http.ResponseWriter, r *http.Request) {
	var req webhookRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	projectID, ok := s.validateWebhook(w, r, &req)
	if !ok {
		return
	}
	enabled := true
	if req.IsEnabled != nil {
		enabled = *req.IsEnabled
	}
	hook, err := s.store.UpdateWebhook(r.Context(), chi.URLParam(r, "id"), req.Name, req.URL, req.Events, projectID, enabled, req.Secret)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "webhook not found")
		return
	}
	if err != nil {
		s.internalError(w, "update webhook", err)
		return
	}
	s.audit(r, "webhook.updated", hook.Name, nil)
	writeJSON(w, http.StatusOK, hook)
}

func (s *Server) handleAdminDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteWebhook(r.Context(), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "webhook not found")
			return
		}
		s.internalError(w, "delete webhook", err)
		return
	}
	s.audit(r, "webhook.deleted", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	deliveries, err := s.store.ListDeliveries(r.Context(), chi.URLParam(r, "id"), 50)
	if err != nil {
		s.internalError(w, "deliveries", err)
		return
	}
	writeJSON(w, http.StatusOK, deliveries)
}
