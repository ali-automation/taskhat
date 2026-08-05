package httpapi

import (
	"net/http"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// ---- TaskHat For-you home ----

func (s *Server) handleForYou(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r.Context())
	recommended, err := s.store.ForYouRecommendedSpaces(r.Context(), userID, 4)
	if err != nil {
		s.internalError(w, "recommended spaces", err)
		return
	}
	assigned, assignedCount, err := s.store.ForYouAssigned(r.Context(), userID, 20)
	if err != nil {
		s.internalError(w, "assigned", err)
		return
	}
	workedOn, err := s.store.ForYouWorkedOn(r.Context(), userID, 20)
	if err != nil {
		s.internalError(w, "worked on", err)
		return
	}
	viewed, err := s.store.ForYouViewed(r.Context(), userID, 20)
	if err != nil {
		s.internalError(w, "viewed", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"recommended":   recommended,
		"assigned":      assigned,
		"assignedCount": assignedCount,
		"workedOn":      workedOn,
		"viewed":        viewed,
	})
}

// handleIssueViewed records an open, feeding the Viewed tab.
func (s *Server) handleIssueViewed(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if err := s.store.RecordIssueView(r.Context(), issue.ID, userIDFrom(r.Context())); err != nil {
		s.internalError(w, "record view", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var _ = store.ErrNotFound
