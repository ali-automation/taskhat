package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// DocHat (Stage W1): wiki spaces + hierarchical pages. Any signed-in user can
// read and write, like a default-open Confluence; permissions arrive in W4.

func (s *Server) handleRecentWikiPages(w http.ResponseWriter, r *http.Request) {
	pages, err := s.store.RecentWikiPages(r.Context(), userIDFrom(r.Context()), 8)
	if err != nil {
		s.internalError(w, "recent wiki pages", err)
		return
	}
	writeJSON(w, http.StatusOK, pages)
}

func (s *Server) handleListWikiSpaces(w http.ResponseWriter, r *http.Request) {
	spaces, err := s.store.ListWikiSpaces(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "list wiki spaces", err)
		return
	}
	writeJSON(w, http.StatusOK, spaces)
}

func (s *Server) handleCreateWikiSpace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key         string `json:"key"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Key = strings.ToUpper(strings.TrimSpace(req.Key))
	req.Name = strings.TrimSpace(req.Name)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "space name required"
	}
	if !projectKeyRe.MatchString(req.Key) {
		fields["key"] = "2-10 characters, letters and digits, starting with a letter"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}
	space, err := s.store.CreateWikiSpace(r.Context(), req.Key, req.Name, req.Description, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrWikiKeyTaken) {
		writeFieldErrors(w, http.StatusConflict, map[string]string{"key": "a wiki space with this key already exists"})
		return
	}
	if err != nil {
		s.internalError(w, "create wiki space", err)
		return
	}
	s.publish(r, "wiki.space_created", space)
	writeJSON(w, http.StatusCreated, space)
}

// handleGetWikiSpace returns the space plus its full page tree.
func (s *Server) handleGetWikiSpace(w http.ResponseWriter, r *http.Request) {
	space, role, ok := s.requireWikiSpaceByKey(w, r, "viewer")
	if !ok {
		return
	}
	tree, err := s.store.WikiPageTree(r.Context(), space.ID)
	if err != nil {
		s.internalError(w, "wiki tree", err)
		return
	}
	tree, err = s.filterWikiNodes(r, space.ID, tree)
	if err != nil {
		s.internalError(w, "filter wiki tree", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"space": space, "pages": tree, "myRole": role})
}

type wikiPageRequest struct {
	Title    string          `json:"title"`
	Icon     string          `json:"icon"`
	Kind     string          `json:"kind"` // "" | page | whiteboard
	ParentID *string         `json:"parentId"`
	BodyDoc  json.RawMessage `json:"bodyDoc"`
}

func (s *Server) handleCreateWikiPage(w http.ResponseWriter, r *http.Request) {
	space, _, ok := s.requireWikiSpaceByKey(w, r, "collaborator")
	if !ok {
		return
	}
	var req wikiPageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"title": "page title required"})
		return
	}
	if req.Kind != "" && req.Kind != "page" && req.Kind != "whiteboard" && req.Kind != "blog" && req.Kind != "folder" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"kind": "must be page, whiteboard, blog or folder"})
		return
	}
	if req.Kind == "blog" {
		req.ParentID = nil // blogs live on the timeline, not in the tree
	}
	bodyText := docText(req.BodyDoc)
	if req.Kind == "whiteboard" {
		bodyText = canvasText(req.BodyDoc)
	}
	id, err := s.store.CreateWikiPage(r.Context(), space.ID, req.ParentID, req.Title, req.Icon,
		req.Kind, req.BodyDoc, bodyText, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create wiki page", err)
		return
	}
	if err := s.store.SetWikiIssueMentions(r.Context(), id, docIssueKeys(req.BodyDoc)); err != nil {
		s.log.Error("wiki mentions", "error", err)
	}
	page, err := s.store.GetWikiPage(r.Context(), id)
	if err != nil {
		s.internalError(w, "load wiki page", err)
		return
	}
	s.publish(r, "wiki.page_created", page)
	writeJSON(w, http.StatusCreated, page)
}

func (s *Server) handleGetWikiPage(w http.ResponseWriter, r *http.Request) {
	if !s.requireWikiView(w, r, chi.URLParam(r, "id")) {
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
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleUpdateWikiPage(w http.ResponseWriter, r *http.Request) {
	var req wikiPageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"title": "page title required"})
		return
	}
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
		return
	}
	err := s.store.UpdateWikiPage(r.Context(), id, req.Title, req.Icon, req.BodyDoc, docText(req.BodyDoc), userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		s.internalError(w, "update wiki page", err)
		return
	}
	if err := s.store.SetWikiIssueMentions(r.Context(), id, docIssueKeys(req.BodyDoc)); err != nil {
		s.log.Error("wiki mentions", "error", err)
	}
	page, err := s.store.GetWikiPage(r.Context(), id)
	if err != nil {
		s.internalError(w, "load wiki page", err)
		return
	}
	s.publish(r, "wiki.page_updated", page)
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleMoveWikiPage(w http.ResponseWriter, r *http.Request) {
	if !s.requireWikiPageRole(w, r, chi.URLParam(r, "id"), "collaborator") {
		return
	}
	var req struct {
		ParentID *string `json:"parentId"`
		Position int     `json:"position"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	err := s.store.MoveWikiPage(r.Context(), chi.URLParam(r, "id"), req.ParentID, req.Position)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteWikiPage(w http.ResponseWriter, r *http.Request) {
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
	if err := s.store.TrashWikiPage(r.Context(), page.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "page not found")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.publish(r, "wiki.page_deleted", page)
	w.WriteHeader(http.StatusNoContent)
}

// ---- Stage W2: editor images + drafts ----

// handleUploadWikiImage stores an editor image; served publicly by
// unguessable UUID key, same pragmatic model as avatars.
func (s *Server) handleUploadWikiImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImageSize)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "multipart field 'file' required (max 5 MiB)")
		return
	}
	defer file.Close()
	mime := header.Header.Get("Content-Type")
	if !strings.HasPrefix(mime, "image/") {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"file": "must be an image"})
		return
	}
	key, err := s.store.CreateWikiImage(r.Context(), mime, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create wiki image", err)
		return
	}
	if err := s.blobs.Put(r.Context(), "wiki/"+key, file, header.Size, mime); err != nil {
		s.internalError(w, "store wiki image", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"url": "/api/v1/wiki-images/" + key})
}

func (s *Server) handleServeWikiImage(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	mime, err := s.store.WikiImageMime(r.Context(), key)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	body, err := s.blobs.Get(r.Context(), "wiki/"+key)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, body)
}

type wikiDraftRequest struct {
	DraftID  string          `json:"draftId"`
	PageID   *string         `json:"pageId"`
	SpaceKey string          `json:"spaceKey"`
	ParentID *string         `json:"parentId"`
	Title    string          `json:"title"`
	BodyDoc  json.RawMessage `json:"bodyDoc"`
}

// handleSaveWikiDraft is the editor's autosave endpoint.
func (s *Server) handleSaveWikiDraft(w http.ResponseWriter, r *http.Request) {
	var req wikiDraftRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	space, err := s.store.GetWikiSpace(r.Context(), strings.ToUpper(req.SpaceKey))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "wiki space not found")
		return
	}
	if err != nil {
		s.internalError(w, "get wiki space", err)
		return
	}
	if _, ok := s.requireWikiSpaceRole(w, r, space.ID, "collaborator"); !ok {
		return
	}
	draft, err := s.store.SaveWikiDraft(r.Context(), req.DraftID, userIDFrom(r.Context()),
		req.PageID, space.ID, req.ParentID, strings.TrimSpace(req.Title), req.BodyDoc)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "draft not found")
		return
	}
	if err != nil {
		s.internalError(w, "save wiki draft", err)
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

// handleGetWikiPageDraft returns the caller's unpublished draft for a page.
func (s *Server) handleGetWikiPageDraft(w http.ResponseWriter, r *http.Request) {
	draft, err := s.store.WikiDraftForPage(r.Context(), userIDFrom(r.Context()), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no draft")
		return
	}
	if err != nil {
		s.internalError(w, "get wiki draft", err)
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (s *Server) handleDeleteWikiDraft(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteWikiDraft(r.Context(), chi.URLParam(r, "id"), userIDFrom(r.Context())); err != nil {
		s.internalError(w, "delete wiki draft", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleSaveWikiCanvas persists a whiteboard's scene in place. Whiteboards
// autosave every few seconds, so saves bump neither versions nor watchers.
func (s *Server) handleSaveWikiCanvas(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !s.requireWikiPageRole(w, r, id, "collaborator") {
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
	if page.Kind != "whiteboard" {
		writeError(w, http.StatusBadRequest, "only whiteboards save a canvas")
		return
	}
	var req struct {
		Title string          `json:"title"`
		Doc   json.RawMessage `json:"doc"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		req.Title = page.Title
	}
	if err := s.store.UpdateWikiCanvas(r.Context(), id, req.Title, req.Doc, canvasText(req.Doc), userIDFrom(r.Context())); err != nil {
		s.internalError(w, "save canvas", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
