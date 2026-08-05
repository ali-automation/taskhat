package store

import (
	"context"
	"fmt"
	"time"
)

// ---- W11: reactions + page views ----

// ReactionGroup is one emoji's tally on a page or comment.
type ReactionGroup struct {
	Emoji string   `json:"emoji"`
	Count int      `json:"count"`
	Mine  bool     `json:"mine"`
	Users []string `json:"users"` // first few display names
}

const reactionGroupQuery = `
SELECT r.emoji, count(*),
       bool_or(r.user_id = $2),
       (array_agg(u.display_name ORDER BY r.created_at))[1:5]
FROM wiki_reactions r JOIN users u ON u.id = r.user_id
WHERE %s = $1
GROUP BY r.emoji
ORDER BY min(r.created_at)`

func (s *Store) scanReactionGroups(ctx context.Context, col, targetID, viewerID string) ([]ReactionGroup, error) {
	rows, err := s.pool.Query(ctx, fmt.Sprintf(reactionGroupQuery, col), targetID, viewerID)
	if err != nil {
		return nil, fmt.Errorf("reactions: %w", err)
	}
	defer rows.Close()
	out := []ReactionGroup{}
	for rows.Next() {
		var g ReactionGroup
		if err := rows.Scan(&g.Emoji, &g.Count, &g.Mine, &g.Users); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// WikiPageReactions returns the page's groups plus every comment's groups.
func (s *Store) WikiPageReactions(ctx context.Context, pageID, viewerID string) ([]ReactionGroup, map[string][]ReactionGroup, error) {
	page, err := s.scanReactionGroups(ctx, "r.page_id", pageID, viewerID)
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.comment_id, r.emoji, count(*), bool_or(r.user_id = $2),
		       (array_agg(u.display_name ORDER BY r.created_at))[1:5]
		FROM wiki_reactions r
		JOIN users u ON u.id = r.user_id
		JOIN wiki_comments c ON c.id = r.comment_id
		WHERE c.page_id = $1
		GROUP BY r.comment_id, r.emoji
		ORDER BY min(r.created_at)`, pageID, viewerID)
	if err != nil {
		return nil, nil, fmt.Errorf("comment reactions: %w", err)
	}
	defer rows.Close()
	comments := map[string][]ReactionGroup{}
	for rows.Next() {
		var cid string
		var g ReactionGroup
		if err := rows.Scan(&cid, &g.Emoji, &g.Count, &g.Mine, &g.Users); err != nil {
			return nil, nil, err
		}
		comments[cid] = append(comments[cid], g)
	}
	return page, comments, rows.Err()
}

// ToggleWikiReaction adds or removes the caller's reaction; added reports
// the direction.
func (s *Store) ToggleWikiReaction(ctx context.Context, pageID, commentID *string, userID, emoji string) (added bool, err error) {
	col, id := "page_id", pageID
	if commentID != nil {
		col, id = "comment_id", commentID
	}
	ct, err := s.pool.Exec(ctx,
		fmt.Sprintf(`DELETE FROM wiki_reactions WHERE %s = $1 AND user_id = $2 AND emoji = $3`, col),
		*id, userID, emoji)
	if err != nil {
		return false, fmt.Errorf("toggle reaction: %w", err)
	}
	if ct.RowsAffected() > 0 {
		return false, nil
	}
	_, err = s.pool.Exec(ctx,
		fmt.Sprintf(`INSERT INTO wiki_reactions (%s, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, col),
		*id, userID, emoji)
	if err != nil {
		return false, fmt.Errorf("add reaction: %w", err)
	}
	return true, nil
}

// RecordWikiPageView upserts the viewer row (idempotent per user).
func (s *Store) RecordWikiPageView(ctx context.Context, pageID, userID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO wiki_page_views (page_id, user_id) VALUES ($1, $2)
		ON CONFLICT (page_id, user_id) DO UPDATE SET last_viewed_at = now()`, pageID, userID)
	if err != nil {
		return fmt.Errorf("record view: %w", err)
	}
	return nil
}

type WikiPageViewer struct {
	User         User      `json:"user"`
	LastViewedAt time.Time `json:"lastViewedAt"`
}

func (s *Store) WikiPageViewers(ctx context.Context, pageID string, limit int) ([]WikiPageViewer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at, v.last_viewed_at
		FROM wiki_page_views v JOIN users u ON u.id = v.user_id
		WHERE v.page_id = $1 ORDER BY v.last_viewed_at DESC LIMIT $2`, pageID, limit)
	if err != nil {
		return nil, fmt.Errorf("page viewers: %w", err)
	}
	defer rows.Close()
	out := []WikiPageViewer{}
	for rows.Next() {
		var v WikiPageViewer
		if err := rows.Scan(&v.User.ID, &v.User.Email, &v.User.DisplayName, &v.User.AvatarURL,
			&v.User.IsActive, &v.User.CreatedAt, &v.LastViewedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
