package store

import (
	"context"
	"fmt"
)

// Stars power the sidebar "Starred" section and the space/board ⋯ menus
// ("Add to starred"), like Jira.

type StarredItem struct {
	Kind       string  `json:"kind"` // space | board
	ID         string  `json:"id"`   // project id or board id
	Key        string  `json:"key"`  // project key (owning space for boards)
	Name       string  `json:"name"`
	AvatarURL  *string `json:"avatarUrl"`
}

// SetStar stars or unstars a target after verifying the user can see it.
func (s *Store) SetStar(ctx context.Context, userID, kind, targetID string, on bool) error {
	var visible bool
	switch kind {
	case "space":
		if err := s.pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2)`,
			targetID, userID).Scan(&visible); err != nil {
			return err
		}
	case "board":
		if err := s.pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM boards b
			  JOIN project_members m ON m.project_id = b.project_id
			  WHERE b.id = $1 AND m.user_id = $2)`,
			targetID, userID).Scan(&visible); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown star kind %q", kind)
	}
	if !visible {
		return ErrNotFound
	}
	if on {
		_, err := s.pool.Exec(ctx, `
			INSERT INTO user_stars (user_id, kind, target_id) VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING`, userID, kind, targetID)
		return err
	}
	_, err := s.pool.Exec(ctx, `
		DELETE FROM user_stars WHERE user_id = $1 AND kind = $2 AND target_id = $3`,
		userID, kind, targetID)
	return err
}

// ListStars returns the user's starred spaces and boards (still-visible only).
func (s *Store) ListStars(ctx context.Context, userID string) ([]StarredItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT 'space', p.id, p.key, p.name, p.avatar_key
		FROM user_stars st
		JOIN projects p ON p.id = st.target_id
		JOIN project_members m ON m.project_id = p.id AND m.user_id = st.user_id
		WHERE st.user_id = $1 AND st.kind = 'space' AND p.archived_at IS NULL
		UNION ALL
		SELECT 'board', b.id, p.key, b.name, NULL
		FROM user_stars st
		JOIN boards b ON b.id = st.target_id
		JOIN projects p ON p.id = b.project_id
		JOIN project_members m ON m.project_id = p.id AND m.user_id = st.user_id
		WHERE st.user_id = $1 AND st.kind = 'board' AND p.archived_at IS NULL
		ORDER BY 1, 4`, userID)
	if err != nil {
		return nil, fmt.Errorf("list stars: %w", err)
	}
	defer rows.Close()
	out := []StarredItem{}
	for rows.Next() {
		var it StarredItem
		var avatarKey *string
		if err := rows.Scan(&it.Kind, &it.ID, &it.Key, &it.Name, &avatarKey); err != nil {
			return nil, err
		}
		if avatarKey != nil {
			u := "/api/v1/avatars/" + *avatarKey
			it.AvatarURL = &u
		}
		out = append(out, it)
	}
	return out, rows.Err()
}
