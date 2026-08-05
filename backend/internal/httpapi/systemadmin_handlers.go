package httpapi

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/mailer"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- audit log ----

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	startAt := intParam(q.Get("startAt"), 0)
	maxResults := intParam(q.Get("maxResults"), 50)
	if maxResults > 200 {
		maxResults = 200
	}
	entries, total, err := s.store.ListAudit(r.Context(), strings.TrimSpace(q.Get("query")), q.Get("action"), startAt, maxResults)
	if err != nil {
		s.internalError(w, "audit list", err)
		return
	}
	actions, err := s.store.AuditActions(r.Context())
	if err != nil {
		s.internalError(w, "audit actions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"startAt":    startAt,
		"maxResults": maxResults,
		"total":      total,
		"isLast":     startAt+len(entries) >= total,
		"values":     entries,
		"actions":    actions,
	})
}

// ---- test email ----

type testEmailRequest struct {
	To string `json:"to"`
}

func (s *Server) handleAdminTestEmail(w http.ResponseWriter, r *http.Request) {
	var req testEmailRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.To = strings.TrimSpace(req.To)
	if _, err := mail.ParseAddress(req.To); err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"to": "valid email required"})
		return
	}
	smtp := s.smtpConfig(r)
	if !smtp.Enabled() {
		writeError(w, http.StatusBadRequest, "no SMTP server configured — set one first")
		return
	}
	siteName := s.store.SettingStr(r.Context(), "site_name", "TaskHat")
	body := "This is a test email from " + siteName + ".\r\n\r\nIf you can read this, outgoing mail works.\r\n"
	if err := mailer.Send(smtp, req.To, "["+siteName+"] Test email", body); err != nil {
		s.audit(r, "mail.test_failed", req.To, map[string]any{"error": err.Error()})
		writeError(w, http.StatusBadGateway, "sending failed: "+err.Error())
		return
	}
	s.audit(r, "mail.test_sent", req.To, nil)
	writeJSON(w, http.StatusOK, map[string]any{"sent": true, "smtp": smtp.Redacted(), "from": smtp.From})
}

// ---- space categories ----

func (s *Server) handleAdminListCategories(w http.ResponseWriter, r *http.Request) {
	cats, err := s.store.ListCategories(r.Context())
	if err != nil {
		s.internalError(w, "categories", err)
		return
	}
	writeJSON(w, http.StatusOK, cats)
}

type categoryRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleAdminCreateCategory(w http.ResponseWriter, r *http.Request) {
	var req categoryRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"name": "category name required"})
		return
	}
	cat, err := s.store.CreateCategory(r.Context(), req.Name)
	if errors.Is(err, store.ErrCategoryTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"name": "a category with this name already exists"})
		return
	}
	if err != nil {
		s.internalError(w, "create category", err)
		return
	}
	s.audit(r, "category.created", cat.Name, nil)
	writeJSON(w, http.StatusCreated, cat)
}

func (s *Server) handleAdminDeleteCategory(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCategory(r.Context(), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "category not found")
			return
		}
		s.internalError(w, "delete category", err)
		return
	}
	s.audit(r, "category.deleted", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

type setCategoryRequest struct {
	ID *string `json:"id"` // null detaches
}

func (s *Server) handleAdminSetProjectCategory(w http.ResponseWriter, r *http.Request) {
	var req setCategoryRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.ID != nil && *req.ID == "" {
		req.ID = nil
	}
	key := strings.ToUpper(chi.URLParam(r, "key"))
	if err := s.store.SetProjectCategory(r.Context(), key, req.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "space or category not found")
			return
		}
		s.internalError(w, "set category", err)
		return
	}
	s.audit(r, "space.category_changed", key, nil)
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminUnarchive lets site admins unarchive spaces they aren't members of.
func (s *Server) handleAdminUnarchive(w http.ResponseWriter, r *http.Request) {
	key := strings.ToUpper(chi.URLParam(r, "key"))
	project, err := s.store.SetProjectArchived(r.Context(), key, false)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "space not found")
		return
	}
	if err != nil {
		s.internalError(w, "unarchive", err)
		return
	}
	s.audit(r, "space.unarchived", key, nil)
	writeJSON(w, http.StatusOK, project)
}
