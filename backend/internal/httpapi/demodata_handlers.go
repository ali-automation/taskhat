package httpapi

import (
	"errors"
	"net/http"

	"github.com/ali-automation/taskhat/backend/internal/seed"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// Admin settings > System > Demo data: create/remove the sample dataset.

func (s *Server) demoSeeder() *seed.Seeder {
	return &seed.Seeder{St: s.store, Blobs: s.blobs}
}

func (s *Server) handleDemoDataStatus(w http.ResponseWriter, r *http.Request) {
	taskhat, dochat := s.demoSeeder().Present(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"taskhat": taskhat, "dochat": dochat,
		"projectKey": seed.ProjectKey, "wikiKey": seed.WikiKey,
	})
}

func (s *Server) handleDemoDataCreate(w http.ResponseWriter, r *http.Request) {
	if err := s.demoSeeder().Create(r.Context(), userIDFrom(r.Context())); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	s.audit(r, "demo_data.created", seed.ProjectKey, nil)
	s.handleDemoDataStatus(w, r)
}

func (s *Server) handleDemoDataDelete(w http.ResponseWriter, r *http.Request) {
	var blobKeys []string

	for _, projectKey := range seed.ProjectKeys {
		project, err := s.store.GetProjectByKey(r.Context(), projectKey)
		if err != nil {
			continue
		}
		keys, err := s.store.DeleteProject(r.Context(), project.Key)
		if err != nil {
			s.internalError(w, "delete demo project", err)
			return
		}
		blobKeys = append(blobKeys, keys...)
		if jobKeys, err := s.store.DeleteImportJobsForTarget(r.Context(), project.Key, false); err == nil {
			blobKeys = append(blobKeys, jobKeys...)
		}
	}
	for _, wikiKey := range seed.WikiKeys {
		space, err := s.store.GetWikiSpace(r.Context(), wikiKey)
		if err != nil {
			continue
		}
		keys, err := s.store.DeleteWikiSpace(r.Context(), space.ID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.internalError(w, "delete demo wiki space", err)
			return
		}
		blobKeys = append(blobKeys, keys...)
	}
	for _, key := range blobKeys {
		if err := s.blobs.Delete(r.Context(), key); err != nil {
			s.log.Error("delete demo blob", "key", key, "error", err)
		}
	}
	if err := s.store.DeleteUsersByEmailDomain(r.Context(), seed.UserDomain); err != nil {
		s.log.Error("delete demo users", "error", err)
	}
	s.audit(r, "demo_data.deleted", seed.ProjectKey, map[string]any{"blobs": len(blobKeys)})
	s.handleDemoDataStatus(w, r)
}
