package store

import (
	"context"
	"fmt"
)

// ---- Stage W4: view restrictions (inherit down the tree, like Confluence) ----

// CanViewWikiPage: a page is viewable unless it, or any ancestor, carries
// restrictions that exclude the user. Site admins always see everything.
func (s *Store) CanViewWikiPage(ctx context.Context, pageID, userID string) (bool, error) {
	var blocked bool
	err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE trail AS (
			SELECT id, parent_id FROM wiki_pages WHERE id = $1
			UNION ALL
			SELECT w.id, w.parent_id FROM wiki_pages w JOIN trail t ON w.id = t.parent_id
		)
		SELECT EXISTS (
			SELECT 1 FROM trail t
			WHERE EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = t.id)
			  AND NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = t.id AND r.user_id = $2)
		) OR NOT EXISTS (
			SELECT 1 FROM wiki_pages pg JOIN wiki_spaces s ON s.id = pg.space_id
			WHERE pg.id = $1 AND pg.deleted_at IS NULL AND `+wikiAccessClause("s", "$2")+`
		)`, pageID, userID).Scan(&blocked)
	if err != nil {
		return false, fmt.Errorf("wiki can view: %w", err)
	}
	if !blocked {
		return true, nil
	}
	isAdmin, err := s.IsAdmin(ctx, userID)
	if err != nil {
		return false, err
	}
	return isAdmin, nil
}

// ViewableWikiPageIDs filters a space's tree for one user in a single query:
// returns the ids of pages whose own restrictions (if any) include the user.
// Tree inheritance is applied by the caller while walking parent links.
func (s *Store) WikiRestrictedPages(ctx context.Context, spaceID, userID string) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id,
		       EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $2)
		FROM wiki_pages p
		WHERE p.space_id = $1
		  AND EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)`, spaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("wiki restricted pages: %w", err)
	}
	defer rows.Close()
	// blocked[id] = true when the page has restrictions NOT including the user.
	blocked := map[string]bool{}
	for rows.Next() {
		var id string
		var allowed bool
		if err := rows.Scan(&id, &allowed); err != nil {
			return nil, err
		}
		blocked[id] = !allowed
	}
	return blocked, rows.Err()
}

func (s *Store) ListWikiRestrictions(ctx context.Context, pageID string) ([]User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_page_restrictions r JOIN users u ON u.id = r.user_id
		WHERE r.page_id = $1 ORDER BY u.display_name`, pageID)
	if err != nil {
		return nil, fmt.Errorf("wiki restrictions: %w", err)
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.IsActive, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// SetWikiRestrictions replaces the page's restriction list. The caller is
// always included so nobody locks themselves out (Confluence does the same).
func (s *Store) SetWikiRestrictions(ctx context.Context, pageID string, userIDs []string, callerID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("restrictions tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM wiki_page_restrictions WHERE page_id = $1`, pageID); err != nil {
		return fmt.Errorf("clear restrictions: %w", err)
	}
	if len(userIDs) > 0 {
		seen := map[string]bool{}
		ids := append([]string{}, userIDs...)
		ids = append(ids, callerID)
		for _, id := range ids {
			if seen[id] {
				continue
			}
			seen[id] = true
			if _, err := tx.Exec(ctx, `
				INSERT INTO wiki_page_restrictions (page_id, user_id) VALUES ($1, $2)
				ON CONFLICT DO NOTHING`, pageID, id); err != nil {
				return fmt.Errorf("add restriction: %w", err)
			}
		}
	}
	return tx.Commit(ctx)
}

// GrantWikiView adds a user to an already-restricted page (Share does this).
func (s *Store) GrantWikiView(ctx context.Context, pageID, userID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO wiki_page_restrictions (page_id, user_id)
		SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM wiki_page_restrictions WHERE page_id = $1)
		ON CONFLICT DO NOTHING`, pageID, userID)
	return err
}

// ---- labels ----

func (s *Store) WikiPageLabels(ctx context.Context, pageID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT label FROM wiki_page_labels WHERE page_id = $1 ORDER BY label`, pageID)
	if err != nil {
		return nil, fmt.Errorf("wiki labels: %w", err)
	}
	defer rows.Close()
	labels := []string{}
	for rows.Next() {
		var l string
		if err := rows.Scan(&l); err != nil {
			return nil, err
		}
		labels = append(labels, l)
	}
	return labels, rows.Err()
}

func (s *Store) SetWikiPageLabels(ctx context.Context, pageID string, labels []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("labels tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM wiki_page_labels WHERE page_id = $1`, pageID); err != nil {
		return fmt.Errorf("clear labels: %w", err)
	}
	for _, l := range labels {
		if _, err := tx.Exec(ctx, `
			INSERT INTO wiki_page_labels (page_id, label) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			pageID, l); err != nil {
			return fmt.Errorf("add label: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// WikiPagesByLabel lists a space's pages carrying a label (caller filters
// restricted ones via the tree walk it already has).
func (s *Store) WikiPagesByLabel(ctx context.Context, spaceID, label string) ([]WikiPageNode, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.parent_id, p.position
		FROM wiki_pages p JOIN wiki_page_labels l ON l.page_id = p.id
		WHERE p.space_id = $1 AND l.label = $2 ORDER BY p.title`, spaceID, label)
	if err != nil {
		return nil, fmt.Errorf("wiki pages by label: %w", err)
	}
	defer rows.Close()
	nodes := []WikiPageNode{}
	for rows.Next() {
		var n WikiPageNode
		if err := rows.Scan(&n.ID, &n.Title, &n.Icon, &n.ParentID, &n.Position); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

// ---- quick search ----

type WikiSearchHit struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Icon      string `json:"icon"`
	Kind      string `json:"kind"`
	SpaceKey  string `json:"spaceKey"`
	SpaceName string `json:"spaceName"`
	Draft     bool   `json:"draft"`
}

// WikiQuickSearch matches titles and body text; pages blocked for the user by
// their own restriction rows are excluded (ancestor inheritance is enforced
// again on open, so a stale hit can never be read).
func (s *Store) WikiQuickSearch(ctx context.Context, userID, q, spaceKey, contributorID string, limit int) ([]WikiSearchHit, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.kind, sp.key, sp.name,
		       EXISTS (SELECT 1 FROM wiki_drafts d WHERE d.page_id = p.id AND d.user_id = $1)
		FROM wiki_pages p JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE (p.title ILIKE '%' || $2 || '%' OR p.body_text ILIKE '%' || $2 || '%')
		  AND p.archived_at IS NULL AND p.deleted_at IS NULL
		  AND ($4 = '' OR sp.key = $4)
		  AND ($5 = '' OR p.created_by::text = $5 OR p.updated_by::text = $5)
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $1))
		  AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY p.updated_at DESC LIMIT $3`, userID, q, limit, spaceKey, contributorID)
	if err != nil {
		return nil, fmt.Errorf("wiki quick search: %w", err)
	}
	defer rows.Close()
	hits := []WikiSearchHit{}
	for rows.Next() {
		var h WikiSearchHit
		if err := rows.Scan(&h.ID, &h.Title, &h.Icon, &h.Kind, &h.SpaceKey, &h.SpaceName, &h.Draft); err != nil {
			return nil, err
		}
		hits = append(hits, h)
	}
	return hits, rows.Err()
}

// ---- Stage W5: TaskHat ⇄ DocHat mentions ----

// SetWikiIssueMentions records which work items a page's chips reference.
func (s *Store) SetWikiIssueMentions(ctx context.Context, pageID string, issueKeys []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("mentions tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM wiki_issue_mentions WHERE page_id = $1`, pageID); err != nil {
		return fmt.Errorf("clear mentions: %w", err)
	}
	for _, key := range issueKeys {
		if _, err := tx.Exec(ctx, `
			INSERT INTO wiki_issue_mentions (page_id, issue_id)
			SELECT $1, i.id FROM issues i JOIN projects p ON p.id = i.project_id
			WHERE p.key || '-' || i.number = $2
			ON CONFLICT DO NOTHING`, pageID, key); err != nil {
			return fmt.Errorf("add mention: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// MentionedOnPages lists wiki pages whose chips reference the issue,
// excluding pages the user's own restrictions block.
func (s *Store) MentionedOnPages(ctx context.Context, issueID, userID string) ([]WikiSearchHit, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.kind, sp.key, sp.name,
		       EXISTS (SELECT 1 FROM wiki_drafts d WHERE d.page_id = p.id AND d.user_id = $2)
		FROM wiki_issue_mentions m
		JOIN wiki_pages p ON p.id = m.page_id
		JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE m.issue_id = $1
		  AND p.archived_at IS NULL AND p.deleted_at IS NULL
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $2))
		  AND `+wikiAccessClause("sp", "$2")+`
		ORDER BY p.updated_at DESC`, issueID, userID)
	if err != nil {
		return nil, fmt.Errorf("mentioned on: %w", err)
	}
	defer rows.Close()
	hits := []WikiSearchHit{}
	for rows.Next() {
		var h WikiSearchHit
		if err := rows.Scan(&h.ID, &h.Title, &h.Icon, &h.Kind, &h.SpaceKey, &h.SpaceName, &h.Draft); err != nil {
			return nil, err
		}
		hits = append(hits, h)
	}
	return hits, rows.Err()
}
