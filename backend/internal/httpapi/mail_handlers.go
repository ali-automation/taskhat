package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ali-automation/taskhat/backend/internal/mailin"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage 25: incoming mail → work items ----

type mailHandlerRequest struct {
	Name         string           `json:"name"`
	ProjectKey   string           `json:"projectKey"`
	IssueType    string           `json:"issueType"`
	Mode         string           `json:"mode"` // webhook | imap (create only)
	IMAP         store.IMAPConfig `json:"imap"`
	AllowReplies *bool            `json:"allowReplies"`
	IsEnabled    *bool            `json:"isEnabled"`
}

func (s *Server) validateMailHandler(w http.ResponseWriter, r *http.Request, req *mailHandlerRequest, create bool) (store.Project, bool) {
	fields := map[string]string{}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		fields["name"] = "handler name required"
	}
	if req.IssueType == "" {
		req.IssueType = "task"
	}
	if ok, err := s.store.WorkTypeEnabled(r.Context(), req.IssueType); err != nil || !ok {
		fields["issueType"] = "unknown or disabled work type"
	}
	if create && req.Mode != "webhook" && req.Mode != "imap" {
		fields["mode"] = "must be webhook or imap"
	}
	if req.Mode == "imap" && strings.TrimSpace(req.IMAP.Host) == "" {
		fields["imap"] = "imap host required"
	}
	project, err := s.store.GetProjectByKey(r.Context(), strings.ToUpper(strings.TrimSpace(req.ProjectKey)))
	if errors.Is(err, store.ErrNotFound) {
		fields["projectKey"] = "no space with this key"
	} else if err != nil {
		s.internalError(w, "get project", err)
		return store.Project{}, false
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return store.Project{}, false
	}
	return project, true
}

func (s *Server) handleAdminListMailHandlers(w http.ResponseWriter, r *http.Request) {
	handlers, err := s.store.ListMailHandlers(r.Context())
	if err != nil {
		s.internalError(w, "list mail handlers", err)
		return
	}
	writeJSON(w, http.StatusOK, handlers)
}

func (s *Server) handleAdminCreateMailHandler(w http.ResponseWriter, r *http.Request) {
	var req mailHandlerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	project, ok := s.validateMailHandler(w, r, &req, true)
	if !ok {
		return
	}
	var token *string
	if req.Mode == "webhook" {
		buf := make([]byte, 16)
		if _, err := rand.Read(buf); err != nil {
			s.internalError(w, "token", err)
			return
		}
		t := "mh_" + hex.EncodeToString(buf)
		token = &t
	}
	allowReplies := req.AllowReplies == nil || *req.AllowReplies
	id, err := s.store.CreateMailHandler(r.Context(), req.Name, project.ID, req.IssueType,
		req.Mode, token, req.IMAP, allowReplies, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create mail handler", err)
		return
	}
	s.audit(r, "mail_handler.created", req.Name, map[string]any{"mode": req.Mode, "space": project.Key})
	handler, err := s.store.GetMailHandler(r.Context(), id)
	if err != nil {
		s.internalError(w, "get mail handler", err)
		return
	}
	writeJSON(w, http.StatusCreated, handler)
}

func (s *Server) handleAdminUpdateMailHandler(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	existing, err := s.store.GetMailHandler(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "mail handler not found")
		return
	}
	if err != nil {
		s.internalError(w, "get mail handler", err)
		return
	}
	var req mailHandlerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Mode = existing.Mode // mode is fixed after creation
	project, ok := s.validateMailHandler(w, r, &req, false)
	if !ok {
		return
	}
	// A blank password keeps the stored one (the API never echoes it back).
	if req.IMAP.Password == "" {
		req.IMAP.Password = existing.IMAP.Password
	}
	allowReplies := req.AllowReplies == nil || *req.AllowReplies
	isEnabled := req.IsEnabled == nil || *req.IsEnabled
	if err := s.store.UpdateMailHandler(r.Context(), id, req.Name, project.ID, req.IssueType,
		req.IMAP, allowReplies, isEnabled); err != nil {
		s.internalError(w, "update mail handler", err)
		return
	}
	s.audit(r, "mail_handler.updated", req.Name, nil)
	handler, err := s.store.GetMailHandler(r.Context(), id)
	if err != nil {
		s.internalError(w, "get mail handler", err)
		return
	}
	writeJSON(w, http.StatusOK, handler)
}

func (s *Server) handleAdminDeleteMailHandler(w http.ResponseWriter, r *http.Request) {
	err := s.store.DeleteMailHandler(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "mail handler not found")
		return
	}
	if err != nil {
		s.internalError(w, "delete mail handler", err)
		return
	}
	s.audit(r, "mail_handler.deleted", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

// handleIncomingMail is the public inbound-webhook endpoint: mail providers
// (or any script) POST parsed messages to /mail/incoming/{token}.
func (s *Server) handleIncomingMail(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if len(token) < 10 {
		writeError(w, http.StatusNotFound, "unknown mail handler")
		return
	}
	key := "mailin:" + token
	if n, err := s.rdb.Incr(r.Context(), key).Result(); err == nil {
		if n == 1 {
			s.rdb.Expire(r.Context(), key, time.Minute)
		}
		if n > 60 {
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
	}
	handler, err := s.store.MailHandlerByToken(r.Context(), token)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "unknown mail handler")
		return
	}
	if err != nil {
		s.internalError(w, "mail handler", err)
		return
	}
	var req struct {
		From        string `json:"from"`
		Subject     string `json:"subject"`
		Text        string `json:"text"`
		Attachments []struct {
			Filename      string `json:"filename"`
			ContentType   string `json:"contentType"`
			ContentBase64 string `json:"contentBase64"`
		} `json:"attachments"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if !decodeJSON(w, r, &req) {
		return
	}
	m := mailin.Mail{From: req.From, Subject: req.Subject, TextBody: req.Text}
	for _, a := range req.Attachments {
		data, err := base64.StdEncoding.DecodeString(a.ContentBase64)
		if err != nil {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"attachments": "contentBase64 must be valid base64"})
			return
		}
		m.Attachments = append(m.Attachments, mailin.Attachment{
			Filename: a.Filename, ContentType: a.ContentType, Data: data,
		})
	}
	processor := mailin.New(s.store, s.blobs, s.publisher, s.log)
	result, err := processor.Process(r.Context(), handler, m)
	if err != nil {
		s.store.RecordMailResult(r.Context(), handler.ID, 0, err.Error())
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	s.store.RecordMailResult(r.Context(), handler.ID, 1, "")
	writeJSON(w, http.StatusOK, map[string]string{"result": result})
}
