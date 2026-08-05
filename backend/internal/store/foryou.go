package store

import (
	"context"
	"fmt"
	"time"
)

// ---- TaskHat For-you home (Jira's "For you" tabs) ----

func (s *Store) RecordIssueView(ctx context.Context, issueID, userID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO issue_views (issue_id, user_id) VALUES ($1, $2)
		ON CONFLICT (issue_id, user_id) DO UPDATE SET last_viewed_at = now()`, issueID, userID)
	return err
}

type ForYouIssue struct {
	Key            string    `json:"key"`
	Summary        string    `json:"summary"`
	Type           string    `json:"type"`
	StatusName     string    `json:"statusName"`
	StatusCategory string    `json:"statusCategory"`
	ProjectKey     string    `json:"projectKey"`
	ProjectName    string    `json:"projectName"`
	At             time.Time `json:"at"`
	Assignee       *User     `json:"assignee"`
}

const forYouIssueSelect = `
SELECT p.key || '-' || i.number, i.summary, i.type, s.name, s.category, p.key, p.name, %s,
       au.id, au.email, au.display_name, au.avatar_url, au.is_active, au.created_at
FROM issues i
JOIN projects p ON p.id = i.project_id
JOIN statuses s ON s.id = i.status_id
LEFT JOIN users au ON au.id = i.assignee_id
`

func (s *Store) scanForYouIssues(ctx context.Context, query string, args ...any) ([]ForYouIssue, error) {
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("for you issues: %w", err)
	}
	defer rows.Close()
	items := []ForYouIssue{}
	for rows.Next() {
		var it ForYouIssue
		var uid, uemail, uname, uavatar *string
		var uactive *bool
		var ucreated *time.Time
		if err := rows.Scan(&it.Key, &it.Summary, &it.Type, &it.StatusName, &it.StatusCategory,
			&it.ProjectKey, &it.ProjectName, &it.At,
			&uid, &uemail, &uname, &uavatar, &uactive, &ucreated); err != nil {
			return nil, err
		}
		it.Assignee = scanNullableUser(uid, uemail, uname, uavatar, uactive, ucreated)
		items = append(items, it)
	}
	return items, rows.Err()
}

// ForYouAssigned lists the caller's open work items, newest activity first.
func (s *Store) ForYouAssigned(ctx context.Context, userID string, limit int) ([]ForYouIssue, int, error) {
	items, err := s.scanForYouIssues(ctx, fmt.Sprintf(forYouIssueSelect, "i.updated_at")+`
		WHERE i.assignee_id = $1 AND i.resolution IS NULL AND p.archived_at IS NULL
		ORDER BY i.updated_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	var total int
	err = s.pool.QueryRow(ctx, `
		SELECT count(*) FROM issues i JOIN projects p ON p.id = i.project_id
		WHERE i.assignee_id = $1 AND i.resolution IS NULL AND p.archived_at IS NULL`, userID).Scan(&total)
	return items, total, err
}

// ForYouWorkedOn lists items the caller recently touched (edits, comments, worklogs).
func (s *Store) ForYouWorkedOn(ctx context.Context, userID string, limit int) ([]ForYouIssue, error) {
	return s.scanForYouIssues(ctx, fmt.Sprintf(forYouIssueSelect, "x.at")+`
		JOIN (
			SELECT issue_id, max(at) AS at FROM (
				SELECT issue_id, max(created_at) AS at FROM issue_events WHERE actor_id = $1 GROUP BY issue_id
				UNION ALL
				SELECT issue_id, max(created_at) FROM comments WHERE author_id = $1 GROUP BY issue_id
				UNION ALL
				SELECT issue_id, max(created_at) FROM worklogs WHERE author_id = $1 GROUP BY issue_id
			) y GROUP BY issue_id
		) x ON x.issue_id = i.id
		WHERE p.archived_at IS NULL
		ORDER BY x.at DESC LIMIT $2`, userID, limit)
}

// ForYouViewed lists items the caller recently opened.
func (s *Store) ForYouViewed(ctx context.Context, userID string, limit int) ([]ForYouIssue, error) {
	return s.scanForYouIssues(ctx, fmt.Sprintf(forYouIssueSelect, "v.last_viewed_at")+`
		JOIN issue_views v ON v.issue_id = i.id AND v.user_id = $1
		WHERE p.archived_at IS NULL
		ORDER BY v.last_viewed_at DESC LIMIT $2`, userID, limit)
}

type RecommendedSpace struct {
	Key       string    `json:"key"`
	OpenCount int       `json:"openCount"`
	At        time.Time `json:"at"`
}

// ForYouRecommendedSpaces ranks the caller's spaces by their own recent activity.
func (s *Store) ForYouRecommendedSpaces(ctx context.Context, userID string, limit int) ([]RecommendedSpace, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.key,
		       COALESCE((SELECT count(*) FROM issues i2 WHERE i2.project_id = p.id AND i2.resolution IS NULL), 0),
		       COALESCE(max(x.at), p.created_at)
		FROM projects p
		JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
		LEFT JOIN issues i ON i.project_id = p.id
		LEFT JOIN (
			SELECT issue_id, max(at) AS at FROM (
				SELECT issue_id, max(created_at) AS at FROM issue_events WHERE actor_id = $1 GROUP BY issue_id
				UNION ALL
				SELECT issue_id, max(created_at) FROM comments WHERE author_id = $1 GROUP BY issue_id
				UNION ALL
				SELECT issue_id, max(last_viewed_at) FROM issue_views WHERE user_id = $1 GROUP BY issue_id
			) y GROUP BY issue_id
		) x ON x.issue_id = i.id
		WHERE p.archived_at IS NULL
		GROUP BY p.id
		ORDER BY max(x.at) DESC NULLS LAST, p.name
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("recommended spaces: %w", err)
	}
	defer rows.Close()
	spaces := []RecommendedSpace{}
	for rows.Next() {
		var sp RecommendedSpace
		if err := rows.Scan(&sp.Key, &sp.OpenCount, &sp.At); err != nil {
			return nil, err
		}
		spaces = append(spaces, sp)
	}
	return spaces, rows.Err()
}
