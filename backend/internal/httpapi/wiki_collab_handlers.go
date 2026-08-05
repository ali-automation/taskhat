package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- Stage W3: versions, comments, watchers, attachments ----

func (s *Server) handleWikiVersions(w http.ResponseWriter, r *http.Request) {
	if !s.requireWikiView(w, r, chi.URLParam(r, "id")) {
		return
	}
	versions, err := s.store.ListWikiVersions(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.internalError(w, "wiki versions", err)
		return
	}
	writeJSON(w, http.StatusOK, versions)
}

func (s *Server) handleWikiVersion(w http.ResponseWriter, r *http.Request) {
	n, err := strconv.Atoi(chi.URLParam(r, "n"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad version number")
		return
	}
	if !s.requireWikiView(w, r, chi.URLParam(r, "id")) {
		return
	}
	v, err := s.store.GetWikiVersion(r.Context(), chi.URLParam(r, "id"), n)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}
	if err != nil {
		s.internalError(w, "wiki version", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version": v.Version, "title": v.Title, "icon": v.Icon,
		"bodyDoc": json.RawMessage(v.BodyDoc), "bodyText": v.BodyText,
		"editedBy": v.EditedBy, "createdAt": v.CreatedAt,
	})
}

// handleWikiRestore republishes an old revision as a new version.
func (s *Server) handleWikiRestore(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	n, err := strconv.Atoi(chi.URLParam(r, "n"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad version number")
		return
	}
	v, err := s.store.GetWikiVersion(r.Context(), id, n)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "version not found")
		return
	}
	if err != nil {
		s.internalError(w, "wiki version", err)
		return
	}
	if err := s.store.UpdateWikiPage(r.Context(), id, v.Title, v.Icon, v.BodyDoc, v.BodyText, userIDFrom(r.Context())); err != nil {
		s.internalError(w, "restore wiki version", err)
		return
	}
	page, err := s.store.GetWikiPage(r.Context(), id)
	if err != nil {
		s.internalError(w, "load wiki page", err)
		return
	}
	s.publish(r, "wiki.page_updated", page)
	writeJSON(w, http.StatusOK, page)
}

// wikiCommentEvent mirrors the issue CommentEvent shape for the worker.
type wikiCommentEvent struct {
	Page           store.WikiPage `json:"page"`
	Comment        store.WikiComment `json:"comment"`
	MentionUserIDs []string       `json:"mentionUserIds,omitempty"`
}

func (s *Server) handleWikiListComments(w http.ResponseWriter, r *http.Request) {
	if !s.requireWikiView(w, r, chi.URLParam(r, "id")) {
		return
	}
	comments, err := s.store.ListWikiComments(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.internalError(w, "wiki comments", err)
		return
	}
	writeJSON(w, http.StatusOK, comments)
}

type wikiCommentRequest struct {
	Body             string          `json:"body"`
	BodyDoc          json.RawMessage `json:"bodyDoc"`
	ParentID         *string         `json:"parentId"`
	InlineText       string          `json:"inlineText"`
	InlineOccurrence int             `json:"inlineOccurrence"`
}

func (s *Server) handleWikiAddComment(w http.ResponseWriter, r *http.Request) {
	if !s.requireWikiPageRole(w, r, chi.URLParam(r, "id"), "collaborator") {
		return
	}
	page, err := s.store.GetWikiPage(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		s.internalError(w, "get wiki page", err)
		return
	}
	var req wikiCommentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.BodyDoc) > 0 && string(req.BodyDoc) != "null" {
		req.Body = docText(req.BodyDoc)
	} else {
		req.BodyDoc = nil
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"body": "comment cannot be empty"})
		return
	}
	if len(req.InlineText) > 400 {
		req.InlineText = req.InlineText[:400]
	}
	comment, err := s.store.CreateWikiComment(r.Context(), page.ID, userIDFrom(r.Context()), req.Body, req.BodyDoc,
		req.ParentID, strings.TrimSpace(req.InlineText), req.InlineOccurrence)
	if err != nil {
		s.internalError(w, "create wiki comment", err)
		return
	}
	mentions := s.resolveMentions(r, req.Body)
	mentions = append(mentions, docMentionIDs(req.BodyDoc)...)
	s.publish(r, "wiki.comment_added", wikiCommentEvent{Page: page, Comment: comment, MentionUserIDs: dedupe(mentions)})
	writeJSON(w, http.StatusCreated, comment)
}

func (s *Server) handleWikiUpdateComment(w http.ResponseWriter, r *http.Request) {
	var req wikiCommentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.BodyDoc) > 0 && string(req.BodyDoc) != "null" {
		req.Body = docText(req.BodyDoc)
	} else {
		req.BodyDoc = nil
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"body": "comment cannot be empty"})
		return
	}
	comment, err := s.store.UpdateWikiComment(r.Context(), chi.URLParam(r, "commentId"), userIDFrom(r.Context()), req.Body, req.BodyDoc)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment not found (you can only edit your own comments)")
		return
	}
	if err != nil {
		s.internalError(w, "update wiki comment", err)
		return
	}
	writeJSON(w, http.StatusOK, comment)
}

func (s *Server) handleWikiDeleteComment(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := s.store.IsAdmin(r.Context(), userIDFrom(r.Context()))
	_, err := s.store.DeleteWikiComment(r.Context(), chi.URLParam(r, "commentId"), userIDFrom(r.Context()), isAdmin)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment not found (you can only delete your own comments)")
		return
	}
	if err != nil {
		s.internalError(w, "delete wiki comment", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- watchers ----

func (s *Server) handleWikiWatchState(w http.ResponseWriter, r *http.Request) {
	watching, count, err := s.store.WikiWatchState(r.Context(), chi.URLParam(r, "id"), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "wiki watch state", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"watching": watching, "count": count})
}

func (s *Server) handleWikiWatch(watch bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var err error
		if watch {
			err = s.store.WikiWatch(r.Context(), chi.URLParam(r, "id"), userIDFrom(r.Context()))
		} else {
			err = s.store.WikiUnwatch(r.Context(), chi.URLParam(r, "id"), userIDFrom(r.Context()))
		}
		if err != nil {
			s.internalError(w, "wiki watch", err)
			return
		}
		s.handleWikiWatchState(w, r)
	}
}

// ---- attachments ----

const maxWikiAttachment = 20 << 20 // 20 MiB, like issue attachments

func (s *Server) handleWikiListAttachments(w http.ResponseWriter, r *http.Request) {
	if !s.requireWikiView(w, r, chi.URLParam(r, "id")) {
		return
	}
	atts, err := s.store.ListWikiAttachments(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.internalError(w, "wiki attachments", err)
		return
	}
	writeJSON(w, http.StatusOK, atts)
}

func (s *Server) handleWikiUploadAttachment(w http.ResponseWriter, r *http.Request) {
	pageID := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, pageID, "collaborator") {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxWikiAttachment)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "multipart field 'file' required (max 20 MiB)")
		return
	}
	defer file.Close()
	mime := header.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}
	id, err := s.store.CreateWikiAttachment(r.Context(), pageID, header.Filename, mime, header.Size, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create wiki attachment", err)
		return
	}
	if err := s.blobs.Put(r.Context(), "wiki-att/"+id, file, header.Size, mime); err != nil {
		_ = s.store.DeleteWikiAttachment(r.Context(), id)
		s.internalError(w, "store wiki attachment", err)
		return
	}
	atts, err := s.store.ListWikiAttachments(r.Context(), pageID)
	if err != nil {
		s.internalError(w, "wiki attachments", err)
		return
	}
	writeJSON(w, http.StatusCreated, atts)
}

func (s *Server) handleWikiDownloadAttachment(w http.ResponseWriter, r *http.Request) {
	att, pageID, err := s.store.GetWikiAttachment(r.Context(), chi.URLParam(r, "attId"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "attachment not found")
		return
	}
	if err != nil {
		s.internalError(w, "wiki attachment", err)
		return
	}
	if !s.requireWikiView(w, r, pageID) {
		return
	}
	body, err := s.blobs.Get(r.Context(), "wiki-att/"+att.ID)
	if err != nil {
		writeError(w, http.StatusNotFound, "attachment not found")
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", att.Mime)
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(att.Filename, `"`, "")+`"`)
	io.Copy(w, body)
}

func (s *Server) handleWikiDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "attId")
	if pageID, err := s.store.WikiAttachmentPage(r.Context(), id); err == nil {
		if !s.requireWikiPageRole(w, r, pageID, "collaborator") {
			return
		}
	}
	if err := s.store.DeleteWikiAttachment(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "attachment not found")
			return
		}
		s.internalError(w, "delete wiki attachment", err)
		return
	}
	_ = s.blobs.Delete(r.Context(), "wiki-att/"+id)
	w.WriteHeader(http.StatusNoContent)
}

// handleWikiResolveComment resolves or reopens an inline thread.
func (s *Server) handleWikiResolveComment(w http.ResponseWriter, r *http.Request) {
	commentID := chi.URLParam(r, "commentId")
	pageID, err := s.store.WikiCommentPage(r.Context(), commentID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment not found")
		return
	}
	if err != nil {
		s.internalError(w, "wiki comment page", err)
		return
	}
	if !s.requireWikiPageRole(w, r, pageID, "collaborator") {
		return
	}
	var req struct {
		Resolved bool `json:"resolved"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	comment, err := s.store.ResolveWikiComment(r.Context(), commentID, userIDFrom(r.Context()), req.Resolved)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "only root inline comments can be resolved")
		return
	}
	if err != nil {
		s.internalError(w, "resolve wiki comment", err)
		return
	}
	writeJSON(w, http.StatusOK, comment)
}
