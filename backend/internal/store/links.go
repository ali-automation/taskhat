package store

import (
	"context"
	"errors"
	"fmt"
)

var (
	ErrLinkExists = errors.New("these work items are already linked this way")
	ErrSelfLink   = errors.New("a work item cannot link to itself")
)

// LinkTypeNames maps a link type to its outward / inward display phrases
// (Jira semantics: "TH-1 blocks TH-2" ⇔ "TH-2 is blocked by TH-1").
var LinkTypeNames = map[string][2]string{
	"blocks":     {"blocks", "is blocked by"},
	"duplicates": {"duplicates", "is duplicated by"},
	"relates":    {"relates to", "relates to"},
}

// IssueLink is one link as seen from a specific issue.
type IssueLink struct {
	ID           string `json:"id"`
	LinkType     string `json:"linkType"`     // blocks | relates | duplicates
	Relationship string `json:"relationship"` // display phrase for this side
	Other        struct {
		ID             string  `json:"id"`
		Key            string  `json:"key"`
		Summary        string  `json:"summary"`
		Type           string  `json:"type"`
		StatusName     string  `json:"statusName"`
		StatusCategory string  `json:"statusCategory"`
		Priority       string  `json:"priority"`
		AssigneeName   *string `json:"assigneeName"`
	} `json:"other"`
}

// ListIssueLinks returns all links touching an issue, phrased from its side.
func (s *Store) ListIssueLinks(ctx context.Context, issueID string) ([]IssueLink, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.link_type, (l.from_issue_id = $1) AS outward,
		       o.id, p.key || '-' || o.number, o.summary, o.type,
		       st.name, st.category, o.priority, a.display_name
		FROM issue_links l
		JOIN issues o ON o.id = CASE WHEN l.from_issue_id = $1 THEN l.to_issue_id ELSE l.from_issue_id END
		JOIN projects p ON p.id = o.project_id
		JOIN statuses st ON st.id = o.status_id
		LEFT JOIN users a ON a.id = o.assignee_id
		WHERE l.from_issue_id = $1 OR l.to_issue_id = $1
		ORDER BY l.link_type, l.created_at`, issueID)
	if err != nil {
		return nil, fmt.Errorf("list links: %w", err)
	}
	defer rows.Close()
	links := []IssueLink{}
	for rows.Next() {
		var l IssueLink
		var outward bool
		if err := rows.Scan(&l.ID, &l.LinkType, &outward,
			&l.Other.ID, &l.Other.Key, &l.Other.Summary, &l.Other.Type,
			&l.Other.StatusName, &l.Other.StatusCategory, &l.Other.Priority, &l.Other.AssigneeName); err != nil {
			return nil, err
		}
		names := LinkTypeNames[l.LinkType]
		if outward {
			l.Relationship = names[0]
		} else {
			l.Relationship = names[1]
		}
		links = append(links, l)
	}
	return links, rows.Err()
}

// CreateLink links from → to; symmetric duplicates in either direction conflict.
func (s *Store) CreateLink(ctx context.Context, fromID, toID, linkType, createdBy string) (string, error) {
	if fromID == toID {
		return "", ErrSelfLink
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM issue_links
		WHERE link_type = $3
		  AND ((from_issue_id = $1 AND to_issue_id = $2) OR (from_issue_id = $2 AND to_issue_id = $1)))`,
		fromID, toID, linkType).Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return "", ErrLinkExists
	}
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO issue_links (from_issue_id, to_issue_id, link_type, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id`, fromID, toID, linkType, createdBy).Scan(&id)
	if isUniqueViolation(err) {
		return "", ErrLinkExists
	}
	if err != nil {
		return "", fmt.Errorf("create link: %w", err)
	}
	return id, nil
}

// DeleteLink removes a link if it touches the given issue; returns the other
// issue id and link type for the event payload.
func (s *Store) DeleteLink(ctx context.Context, issueID, linkID string) (otherID, linkType string, err error) {
	err = s.pool.QueryRow(ctx, `
		DELETE FROM issue_links
		WHERE id = $2 AND (from_issue_id = $1 OR to_issue_id = $1)
		RETURNING CASE WHEN from_issue_id = $1 THEN to_issue_id ELSE from_issue_id END, link_type`,
		issueID, linkID).Scan(&otherID, &linkType)
	if err != nil {
		return "", "", ErrNotFound
	}
	return otherID, linkType, nil
}

// LinkedIssuesOf resolves the "linked" automation branch.
func (s *Store) LinkedIssuesOf(ctx context.Context, issueID string) ([]Issue, error) {
	rows, err := s.pool.Query(ctx, issueSelect+`
		WHERE i.id IN (
			SELECT CASE WHEN l.from_issue_id = $1 THEN l.to_issue_id ELSE l.from_issue_id END
			FROM issue_links l WHERE l.from_issue_id = $1 OR l.to_issue_id = $1)
		ORDER BY i.number`, issueID)
	if err != nil {
		return nil, fmt.Errorf("linked issues: %w", err)
	}
	defer rows.Close()
	issues := []Issue{}
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			return nil, err
		}
		issues = append(issues, i)
	}
	return issues, rows.Err()
}
