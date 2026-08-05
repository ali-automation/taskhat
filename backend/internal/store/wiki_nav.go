package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Stage W19: search & navigation ----

// RecentViewedWikiPage backs the search dropdown's empty state.
type RecentViewedWikiPage struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Icon      string    `json:"icon"`
	Kind      string    `json:"kind"`
	SpaceKey  string    `json:"spaceKey"`
	SpaceName string    `json:"spaceName"`
	ViewedAt  time.Time `json:"viewedAt"`
	Draft     bool      `json:"draft"`
}

func (s *Store) RecentViewedWikiPages(ctx context.Context, userID string, limit int) ([]RecentViewedWikiPage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.kind, sp.key, sp.name, pv.last_viewed_at,
		       EXISTS (SELECT 1 FROM wiki_drafts d WHERE d.page_id = p.id AND d.user_id = $1)
		FROM wiki_page_views pv
		JOIN wiki_pages p ON p.id = pv.page_id
		JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE pv.user_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $1))
		  AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY pv.last_viewed_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("recent viewed: %w", err)
	}
	defer rows.Close()
	pages := []RecentViewedWikiPage{}
	for rows.Next() {
		var p RecentViewedWikiPage
		if err := rows.Scan(&p.ID, &p.Title, &p.Icon, &p.Kind, &p.SpaceKey, &p.SpaceName, &p.ViewedAt, &p.Draft); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

// ---- space shortcuts ----

type WikiShortcut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

func (s *Store) ListWikiShortcuts(ctx context.Context, spaceID string) ([]WikiShortcut, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, url FROM wiki_space_shortcuts
		WHERE space_id = $1 ORDER BY position, created_at`, spaceID)
	if err != nil {
		return nil, fmt.Errorf("shortcuts: %w", err)
	}
	defer rows.Close()
	shortcuts := []WikiShortcut{}
	for rows.Next() {
		var sc WikiShortcut
		if err := rows.Scan(&sc.ID, &sc.Title, &sc.URL); err != nil {
			return nil, err
		}
		shortcuts = append(shortcuts, sc)
	}
	return shortcuts, rows.Err()
}

func (s *Store) CreateWikiShortcut(ctx context.Context, spaceID, title, url, userID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO wiki_space_shortcuts (space_id, title, url, position, created_by)
		VALUES ($1, $2, $3,
		        (SELECT COALESCE(max(position), -1) + 1 FROM wiki_space_shortcuts WHERE space_id = $1), $4)
		RETURNING id`, spaceID, title, url, userID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create shortcut: %w", err)
	}
	return id, nil
}

func (s *Store) WikiShortcutSpace(ctx context.Context, id string) (string, error) {
	var spaceID string
	err := s.pool.QueryRow(ctx, `SELECT space_id FROM wiki_space_shortcuts WHERE id = $1`, id).Scan(&spaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return spaceID, err
}

func (s *Store) DeleteWikiShortcut(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM wiki_space_shortcuts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete shortcut: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- personal space ----

// PersonalWikiSpace returns the caller's private space, creating it on
// first use (Confluence's personal space).
func (s *Store) PersonalWikiSpace(ctx context.Context, userID, displayName, email string) (WikiSpace, error) {
	var key string
	err := s.pool.QueryRow(ctx,
		`SELECT key FROM wiki_spaces WHERE owner_id = $1 AND is_personal`, userID).Scan(&key)
	if err == nil {
		return s.GetWikiSpace(ctx, key)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return WikiSpace{}, err
	}

	base := ""
	for _, r := range strings.ToUpper(strings.SplitN(email, "@", 2)[0]) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			base += string(r)
		}
	}
	if base == "" || base[0] < 'A' {
		base = "ME" + base
	}
	if len(base) > 10 {
		base = base[:10]
	}
	name := displayName + "'s space"
	for i := 0; i < 10; i++ {
		try := base
		if i > 0 {
			try = fmt.Sprintf("%s%d", base, i)
		}
		sp, err := s.CreateWikiSpace(ctx, try, name, "", userID)
		if errors.Is(err, ErrWikiKeyTaken) {
			continue
		}
		if err != nil {
			return WikiSpace{}, err
		}
		if _, err := s.pool.Exec(ctx, `
			UPDATE wiki_spaces SET is_personal = TRUE, default_role = 'none', owner_id = $2 WHERE id = $1`, sp.ID, userID); err != nil {
			return WikiSpace{}, fmt.Errorf("mark personal: %w", err)
		}
		return s.GetWikiSpace(ctx, try)
	}
	return WikiSpace{}, errors.New("could not allocate a personal space key")
}

// WikiContributors lists people who authored or edited accessible pages,
// optionally scoped to one space — feeds the search Contributor filter.
func (s *Store) WikiContributors(ctx context.Context, userID, spaceKey string) ([]User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_pages p
		JOIN wiki_spaces sp ON sp.id = p.space_id
		JOIN users u ON u.id = p.created_by OR u.id = p.updated_by
		WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
		  AND ($2 = '' OR sp.key = $2)
		  AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY u.display_name
		LIMIT 50`, userID, spaceKey)
	if err != nil {
		return nil, fmt.Errorf("wiki contributors: %w", err)
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// ---- the For-you home (Confluence's "Pick up where you left off" + feed) ----

type ForYouCard struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Icon      string    `json:"icon"`
	Kind      string    `json:"kind"`
	SpaceKey  string    `json:"spaceKey"`
	SpaceName string    `json:"spaceName"`
	At        time.Time `json:"at"`
	Action    string    `json:"action"` // visited | edited
}

// WikiPickUp merges the caller's recently visited and recently edited pages.
func (s *Store) WikiPickUp(ctx context.Context, userID string, limit int) ([]ForYouCard, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.kind, sp.key, sp.name, x.at_time, x.action
		FROM (
			SELECT page_id AS pid, last_viewed_at AS at_time, 'visited' AS action
			FROM wiki_page_views WHERE user_id = $1
			UNION ALL
			SELECT id, updated_at, 'edited' FROM wiki_pages WHERE updated_by = $1
		) x
		JOIN wiki_pages p ON p.id = x.pid
		JOIN wiki_spaces sp ON sp.id = p.space_id
		WHERE p.archived_at IS NULL AND p.deleted_at IS NULL
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $1))
		  AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY x.at_time DESC LIMIT 60`, userID)
	if err != nil {
		return nil, fmt.Errorf("pick up: %w", err)
	}
	defer rows.Close()
	seen := map[string]bool{}
	cards := []ForYouCard{}
	for rows.Next() {
		var c ForYouCard
		if err := rows.Scan(&c.ID, &c.Title, &c.Icon, &c.Kind, &c.SpaceKey, &c.SpaceName, &c.At, &c.Action); err != nil {
			return nil, err
		}
		if seen[c.ID] {
			continue
		}
		seen[c.ID] = true
		cards = append(cards, c)
		if len(cards) >= limit {
			break
		}
	}
	return cards, rows.Err()
}

type ForYouFeedItem struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Icon      string    `json:"icon"`
	Kind      string    `json:"kind"`
	SpaceKey  string    `json:"spaceKey"`
	SpaceName string    `json:"spaceName"`
	At        time.Time `json:"at"`
	Actor     *User     `json:"actor"`
}

func (s *Store) scanForYouFeed(rows pgx.Rows) ([]ForYouFeedItem, error) {
	defer rows.Close()
	items := []ForYouFeedItem{}
	for rows.Next() {
		var it ForYouFeedItem
		var uid, uemail, uname, uavatar *string
		var uactive *bool
		var ucreated *time.Time
		if err := rows.Scan(&it.ID, &it.Title, &it.Icon, &it.Kind, &it.SpaceKey, &it.SpaceName, &it.At,
			&uid, &uemail, &uname, &uavatar, &uactive, &ucreated); err != nil {
			return nil, err
		}
		it.Actor = scanNullableUser(uid, uemail, uname, uavatar, uactive, ucreated)
		items = append(items, it)
	}
	return items, rows.Err()
}

// WikiFollowingFeed lists recent activity in spaces the caller watches or stars.
func (s *Store) WikiFollowingFeed(ctx context.Context, userID string, limit int) ([]ForYouFeedItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.kind, sp.key, sp.name, p.updated_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_pages p
		JOIN wiki_spaces sp ON sp.id = p.space_id
		LEFT JOIN users u ON u.id = p.updated_by
		WHERE p.archived_at IS NULL AND p.deleted_at IS NULL AND p.kind <> 'folder'
		  AND (EXISTS (SELECT 1 FROM wiki_space_watchers w WHERE w.space_id = sp.id AND w.user_id = $1)
		       OR EXISTS (SELECT 1 FROM wiki_space_stars st WHERE st.space_id = sp.id AND st.user_id = $1))
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $1))
		  AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY p.updated_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("following feed: %w", err)
	}
	return s.scanForYouFeed(rows)
}

// WikiPopularFeed ranks pages by recent views and reactions.
func (s *Store) WikiPopularFeed(ctx context.Context, userID string, limit int) ([]ForYouFeedItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.icon, p.kind, sp.key, sp.name, p.updated_at,
		       u.id, u.email, u.display_name, u.avatar_url, u.is_active, u.created_at
		FROM wiki_pages p
		JOIN wiki_spaces sp ON sp.id = p.space_id
		LEFT JOIN users u ON u.id = p.updated_by
		LEFT JOIN (SELECT page_id, count(*) AS c FROM wiki_page_views
		           WHERE last_viewed_at > now() - interval '30 days' GROUP BY page_id) v ON v.page_id = p.id
		LEFT JOIN (SELECT page_id, count(*) AS c FROM wiki_reactions
		           WHERE page_id IS NOT NULL GROUP BY page_id) rx ON rx.page_id = p.id
		WHERE p.archived_at IS NULL AND p.deleted_at IS NULL AND p.kind <> 'folder'
		  AND (COALESCE(v.c, 0) + COALESCE(rx.c, 0)) > 0
		  AND (NOT EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id)
		       OR EXISTS (SELECT 1 FROM wiki_page_restrictions r WHERE r.page_id = p.id AND r.user_id = $1))
		  AND `+wikiAccessClause("sp", "$1")+`
		ORDER BY (COALESCE(v.c, 0) + 2 * COALESCE(rx.c, 0)) DESC, p.updated_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("popular feed: %w", err)
	}
	return s.scanForYouFeed(rows)
}
