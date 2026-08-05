package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// CommentEvent is the payload for comment.* domain events.
type CommentEvent struct {
	Issue          store.Issue   `json:"issue"`
	Comment        store.Comment `json:"comment"`
	MentionUserIDs []string      `json:"mentionUserIds,omitempty"`
}

var mentionRe = regexp.MustCompile(`@([\w.+-]+@[\w-]+\.[\w.-]+)`)

func (s *Server) resolveMentions(r *http.Request, body string) []string {
	matches := mentionRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil
	}
	emails := make([]string, 0, len(matches))
	for _, m := range matches {
		emails = append(emails, m[1])
	}
	users, err := s.store.FindUsersByEmails(r.Context(), emails)
	if err != nil {
		s.log.Error("resolve mentions", "error", err)
		return nil
	}
	ids := make([]string, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	return ids
}

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	comments, err := s.store.ListComments(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "list comments", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": comments})
}

type commentRequest struct {
	Body    string          `json:"body"`
	BodyDoc json.RawMessage `json:"bodyDoc"` // TipTap JSON
}

func (s *Server) handleAddComment(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "comment", &issue) {
		return
	}
	var req commentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if len(req.BodyDoc) > 0 && string(req.BodyDoc) != "null" {
		req.Body = docText(req.BodyDoc)
	} else {
		req.BodyDoc = nil
	}
	if req.Body == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"body": "comment cannot be empty"})
		return
	}
	comment, err := s.store.CreateCommentDoc(r.Context(), issue.ID, userIDFrom(r.Context()), req.Body, req.BodyDoc)
	if err != nil {
		s.internalError(w, "create comment", err)
		return
	}
	mentions := s.resolveMentions(r, req.Body)
	mentions = append(mentions, docMentionIDs(req.BodyDoc)...)
	s.publish(r, "comment.added", CommentEvent{
		Issue:          issue,
		Comment:        comment,
		MentionUserIDs: dedupe(mentions),
	})
	writeJSON(w, http.StatusCreated, comment)
}

func dedupe(ids []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// requireCommentAccess checks the caller may modify the comment: the author,
// or a holder of the scheme's edit-all/delete-all comment permission.
func (s *Server) requireCommentAccess(w http.ResponseWriter, r *http.Request, issue store.Issue, perm string) (string, bool) {
	commentID := chi.URLParam(r, "commentId")
	authorID, err := s.store.GetCommentAuthor(r.Context(), issue.ID, commentID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "comment not found")
		return "", false
	}
	if err != nil {
		s.internalError(w, "comment lookup", err)
		return "", false
	}
	if authorID != userIDFrom(r.Context()) {
		if !s.requirePerm(w, r, issue.ProjectID, perm, &issue) {
			return "", false
		}
	}
	return commentID, true
}

func (s *Server) handleUpdateComment(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	commentID, ok := s.requireCommentAccess(w, r, issue, "comment-edit-all")
	if !ok {
		return
	}
	var req commentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if len(req.BodyDoc) > 0 && string(req.BodyDoc) != "null" {
		req.Body = docText(req.BodyDoc)
	} else {
		req.BodyDoc = nil
	}
	if req.Body == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"body": "comment cannot be empty"})
		return
	}
	comment, err := s.store.UpdateCommentDoc(r.Context(), commentID, req.Body, req.BodyDoc)
	if err != nil {
		s.internalError(w, "update comment", err)
		return
	}
	s.publish(r, "comment.updated", CommentEvent{Issue: issue, Comment: comment})
	writeJSON(w, http.StatusOK, comment)
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	commentID, ok := s.requireCommentAccess(w, r, issue, "comment-delete-all")
	if !ok {
		return
	}
	if err := s.store.DeleteComment(r.Context(), commentID); err != nil {
		s.internalError(w, "delete comment", err)
		return
	}
	s.publish(r, "comment.deleted", CommentEvent{Issue: issue, Comment: store.Comment{ID: commentID}})
	w.WriteHeader(http.StatusNoContent)
}

const maxAttachmentSize = 25 << 20 // 25 MiB

func (s *Server) handleListAttachments(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	attachments, err := s.store.ListAttachments(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "list attachments", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": attachments})
}

func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "attach", &issue) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentSize)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "multipart field 'file' required (max 25 MiB)")
		return
	}
	defer file.Close()

	mime := header.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}
	storageKey := uuid.NewString()
	if err := s.blobs.Put(r.Context(), storageKey, file, header.Size, mime); err != nil {
		s.internalError(w, "store blob", err)
		return
	}

	attachment, err := s.store.CreateAttachment(r.Context(), issue.ID, userIDFrom(r.Context()),
		filepath.Base(header.Filename), mime, header.Size, storageKey)
	if err != nil {
		if delErr := s.blobs.Delete(r.Context(), storageKey); delErr != nil {
			s.log.Error("orphan blob cleanup", "key", storageKey, "error", delErr)
		}
		s.internalError(w, "create attachment", err)
		return
	}
	s.publish(r, "issue.updated", issue) // refresh open views
	writeJSON(w, http.StatusCreated, attachment)
}

// requireAttachment loads the attachment and checks project membership.
func (s *Server) requireAttachment(w http.ResponseWriter, r *http.Request) (store.Attachment, store.Issue, bool) {
	attachment, err := s.store.GetAttachment(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "attachment not found")
		return store.Attachment{}, store.Issue{}, false
	}
	if err != nil {
		s.internalError(w, "get attachment", err)
		return store.Attachment{}, store.Issue{}, false
	}
	issue, err := s.store.GetIssueByID(r.Context(), attachment.IssueID)
	if err != nil {
		s.internalError(w, "attachment issue", err)
		return store.Attachment{}, store.Issue{}, false
	}
	if _, err := s.store.MemberRole(r.Context(), issue.ProjectID, userIDFrom(r.Context())); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusForbidden, "you are not a member of this project")
		return store.Attachment{}, store.Issue{}, false
	} else if err != nil {
		s.internalError(w, "member role", err)
		return store.Attachment{}, store.Issue{}, false
	}
	return attachment, issue, true
}

func (s *Server) handleDownloadAttachment(w http.ResponseWriter, r *http.Request) {
	attachment, _, ok := s.requireAttachment(w, r)
	if !ok {
		return
	}
	f, err := s.blobs.Get(r.Context(), attachment.StorageKey)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, "attachment content missing")
		return
	}
	if err != nil {
		s.internalError(w, "open attachment", err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", attachment.Mime)
	disposition := "attachment"
	if r.URL.Query().Get("inline") == "true" {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename=%q", disposition, attachment.Filename))
	w.Header().Set("Content-Length", fmt.Sprint(attachment.SizeBytes))
	io.Copy(w, f)
}

func (s *Server) handleDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	attachment, issue, ok := s.requireAttachment(w, r)
	if !ok {
		return
	}
	if attachment.Uploader.ID != userIDFrom(r.Context()) {
		if !s.requirePerm(w, r, issue.ProjectID, "attach-delete-all", &issue) {
			return
		}
	}
	if err := s.store.DeleteAttachment(r.Context(), attachment.ID); err != nil {
		s.internalError(w, "delete attachment", err)
		return
	}
	if err := s.blobs.Delete(r.Context(), attachment.StorageKey); err != nil {
		s.log.Error("delete blob", "key", attachment.StorageKey, "error", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListWatchers(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	watchers, err := s.store.ListWatchers(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "list watchers", err)
		return
	}
	me := userIDFrom(r.Context())
	isWatching := false
	for _, u := range watchers {
		if u.ID == me {
			isWatching = true
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": watchers, "isWatching": isWatching})
}

func (s *Server) handleWatch(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if err := s.store.AddWatcher(r.Context(), issue.ID, userIDFrom(r.Context())); err != nil {
		s.internalError(w, "watch", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnwatch(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if err := s.store.RemoveWatcher(r.Context(), issue.ID, userIDFrom(r.Context())); err != nil {
		s.internalError(w, "unwatch", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	notifications, unread, err := s.store.ListNotifications(r.Context(), userIDFrom(r.Context()), 50)
	if err != nil {
		s.internalError(w, "list notifications", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": notifications, "unread": unread})
}

type markReadRequest struct {
	IDs []string `json:"ids"`
}

func (s *Server) handleMarkNotificationsRead(w http.ResponseWriter, r *http.Request) {
	var req markReadRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.MarkNotificationsRead(r.Context(), userIDFrom(r.Context()), req.IDs); err != nil {
		s.internalError(w, "mark read", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
