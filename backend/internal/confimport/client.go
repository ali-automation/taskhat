// Package confimport imports a Confluence Cloud space into DocHat: pages are
// fetched over the v2 REST API, their storage-format bodies converted to the
// editor's document JSON, and the page tree recreated under a wiki space.
package confimport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Page is one Confluence page from the v2 API, plus its storage-format body.
// Folders ride along as body-less pages (IsFolder) so the tree keeps its shape.
type Page struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ParentID string `json:"parentId"`
	Position int    `json:"position"`
	Body         string `json:"body"` // storage-format XHTML
	Icon         string `json:"icon,omitempty"` // title emoji
	IsFolder     bool   `json:"isFolder,omitempty"`
	IsWhiteboard bool   `json:"isWhiteboard,omitempty"`
	Attachments  []Attachment `json:"attachments,omitempty"`
	// Atlassian account ids (resolved to people via Data.Users):
	OwnerID      string `json:"ownerId,omitempty"`      // "Owned by" on the byline
	AuthorID     string `json:"authorId,omitempty"`     // original creator
	LastEditorID string `json:"lastEditorId,omitempty"` // current version's author
}

// Attachment is one file attached to a Confluence page.
type Attachment struct {
	ID           string `json:"id"`
	Title        string `json:"title"` // filename
	MediaType    string `json:"mediaType"`
	FileSize     int64  `json:"fileSize"`
	DownloadLink string `json:"downloadLink"`
}

// Space mirrors the v2 space shape we need.
type Space struct {
	ID          string `json:"id"`
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	HomepageID  string `json:"homepageId"`
}

// User is a Confluence account referenced by imported pages. Email is often
// empty — Atlassian hides it unless the profile makes it public.
type User struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email,omitempty"`
}

// Data is the scan snapshot persisted between the scan and run phases.
type Data struct {
	Space Space           `json:"space"`
	Pages []Page          `json:"pages"`
	Users map[string]User `json:"users,omitempty"` // account id → person
}

var errNotFound = fmt.Errorf("not found")

type Client struct {
	base  string
	email string
	token string
	http  *http.Client
}

func NewClient(site, email, token string) *Client {
	return &Client{base: site, email: email, token: token, http: &http.Client{Timeout: 60 * time.Second}}
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	u := path
	if u[0] == '/' {
		u = c.base + u
	}
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return err
		}
		req.SetBasicAuth(c.email, c.token)
		req.Header.Set("Accept", "application/json")
		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 50<<20))
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		switch {
		case resp.StatusCode == http.StatusTooManyRequests:
			lastErr = fmt.Errorf("confluence rate limit (429)")
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt+1) * 2 * time.Second):
			}
			continue
		case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
			return fmt.Errorf("confluence rejected the credentials (%d) — check the email and API token", resp.StatusCode)
		case resp.StatusCode == http.StatusNotFound:
			return errNotFound
		case resp.StatusCode != http.StatusOK:
			return fmt.Errorf("confluence returned %d for %s", resp.StatusCode, path)
		}
		return json.Unmarshal(body, out)
	}
	return lastErr
}

// FetchSpace resolves a space key to the v2 space object.
func (c *Client) FetchSpace(ctx context.Context, key string) (Space, error) {
	var out struct {
		Results []struct {
			ID          json.Number `json:"id"`
			Key         string      `json:"key"`
			Name        string      `json:"name"`
			HomepageID  json.Number `json:"homepageId"`
			Description struct {
				Plain struct {
					Value string `json:"value"`
				} `json:"plain"`
			} `json:"description"`
		} `json:"results"`
	}
	if err := c.get(ctx, "/wiki/api/v2/spaces?keys="+url.QueryEscape(key)+"&description-format=plain", &out); err != nil {
		return Space{}, err
	}
	if len(out.Results) == 0 {
		return Space{}, fmt.Errorf("space %q not found (or the account cannot see it)", key)
	}
	r := out.Results[0]
	return Space{
		ID: r.ID.String(), Key: r.Key, Name: r.Name,
		Description: r.Description.Plain.Value, HomepageID: r.HomepageID.String(),
	}, nil
}

// FetchFolder resolves a Confluence folder (the newer content-tree
// containers). ok=false when the id is not a folder (whiteboard, database…).
func (c *Client) FetchFolder(ctx context.Context, id string) (Page, bool, error) {
	var out struct {
		ID       json.Number `json:"id"`
		Title    string      `json:"title"`
		ParentID json.Number `json:"parentId"`
		Position *int        `json:"position"`
		OwnerID  string      `json:"ownerId"`
		AuthorID string      `json:"authorId"`
	}
	err := c.get(ctx, "/wiki/api/v2/folders/"+url.PathEscape(id), &out)
	if err == errNotFound {
		return Page{}, false, nil
	}
	if err != nil {
		return Page{}, false, err
	}
	pos := 0
	if out.Position != nil {
		pos = *out.Position
	}
	return Page{ID: out.ID.String(), Title: out.Title, ParentID: out.ParentID.String(), Position: pos, IsFolder: true,
		OwnerID: out.OwnerID, AuthorID: out.AuthorID}, true, nil
}

// FetchWhiteboard resolves a whiteboard's metadata (contents are not
// exposed by the API); ok=false when the id isn't a whiteboard either.
func (c *Client) FetchWhiteboard(ctx context.Context, id string) (Page, bool, error) {
	var out struct {
		ID       json.Number `json:"id"`
		Title    string      `json:"title"`
		ParentID json.Number `json:"parentId"`
		Position *int        `json:"position"`
		OwnerID  string      `json:"ownerId"`
		AuthorID string      `json:"authorId"`
	}
	err := c.get(ctx, "/wiki/api/v2/whiteboards/"+url.PathEscape(id), &out)
	if err == errNotFound {
		return Page{}, false, nil
	}
	if err != nil {
		return Page{}, false, err
	}
	pos := 0
	if out.Position != nil {
		pos = *out.Position
	}
	return Page{ID: out.ID.String(), Title: out.Title, ParentID: out.ParentID.String(), Position: pos, IsWhiteboard: true,
		OwnerID: out.OwnerID, AuthorID: out.AuthorID}, true, nil
}

// FetchWhiteboardIDs lists every whiteboard in the space via CQL — the only
// way to enumerate them (the v2 space listing covers pages only).
func (c *Client) FetchWhiteboardIDs(ctx context.Context, spaceKey string) ([]string, error) {
	var ids []string
	next := "/wiki/rest/api/search?limit=50&cql=" + url.QueryEscape(`space = "`+spaceKey+`" and type = whiteboard`)
	for next != "" {
		var out struct {
			Results []struct {
				Content struct {
					ID json.Number `json:"id"`
				} `json:"content"`
			} `json:"results"`
			Links struct {
				Next string `json:"next"`
			} `json:"_links"`
		}
		err := c.get(ctx, next, &out)
		if err == errNotFound {
			return ids, nil // older sites without whiteboards
		}
		if err != nil {
			return nil, err
		}
		for _, r := range out.Results {
			if id := r.Content.ID.String(); id != "" {
				ids = append(ids, id)
			}
		}
		if out.Links.Next == "" || len(out.Results) == 0 {
			break
		}
		next = out.Links.Next
	}
	return ids, nil
}

// FetchAttachments lists a page's attachments (v2, cursor-paged).
func (c *Client) FetchAttachments(ctx context.Context, pageID string) ([]Attachment, error) {
	var atts []Attachment
	next := "/wiki/api/v2/pages/" + url.PathEscape(pageID) + "/attachments?limit=50"
	for next != "" {
		var out struct {
			Results []struct {
				ID           string `json:"id"` // e.g. "att26575116" — not numeric
				Title        string `json:"title"`
				MediaType    string `json:"mediaType"`
				FileSize     int64  `json:"fileSize"`
				DownloadLink string `json:"downloadLink"`
			} `json:"results"`
			Links struct {
				Next string `json:"next"`
			} `json:"_links"`
		}
		err := c.get(ctx, next, &out)
		if err == errNotFound {
			return atts, nil
		}
		if err != nil {
			return nil, err
		}
		for _, r := range out.Results {
			atts = append(atts, Attachment{
				ID: r.ID, Title: r.Title, MediaType: r.MediaType,
				FileSize: r.FileSize, DownloadLink: r.DownloadLink,
			})
		}
		if out.Links.Next == "" || len(out.Results) == 0 {
			break
		}
		next = out.Links.Next
	}
	return atts, nil
}

// Download fetches an attachment binary. Relative links are rooted at
// {site}/wiki; signed-CDN redirects are followed (Go drops the basic-auth
// header cross-host, which is what the CDN expects).
func (c *Client) Download(ctx context.Context, link string, maxBytes int64) ([]byte, error) {
	u := link
	if strings.HasPrefix(link, "/") {
		u = c.base + "/wiki" + link
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.email, c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download returned %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("larger than the %d MiB import limit", maxBytes>>20)
	}
	return data, nil
}

// FetchUser resolves an Atlassian account id to a person via the v1 user
// API — the v2 page payloads carry bare account ids only. ok=false when the
// account no longer exists.
func (c *Client) FetchUser(ctx context.Context, accountID string) (User, bool, error) {
	var out struct {
		AccountID   string `json:"accountId"`
		DisplayName string `json:"displayName"`
		PublicName  string `json:"publicName"`
		Email       string `json:"email"`
	}
	err := c.get(ctx, "/wiki/rest/api/user?accountId="+url.QueryEscape(accountID), &out)
	if err == errNotFound {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, err
	}
	name := out.DisplayName
	if name == "" {
		name = out.PublicName
	}
	return User{AccountID: accountID, DisplayName: name, Email: out.Email}, true, nil
}

// FetchPageEmoji reads the title emoji content property ("emoji-title-published").
func (c *Client) FetchPageEmoji(ctx context.Context, pageID string) (string, error) {
	var out struct {
		Results []struct {
			Value json.RawMessage `json:"value"`
		} `json:"results"`
	}
	err := c.get(ctx, "/wiki/api/v2/pages/"+url.PathEscape(pageID)+"/properties?key=emoji-title-published", &out)
	if err == errNotFound {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if len(out.Results) == 0 {
		return "", nil
	}
	var v string
	if json.Unmarshal(out.Results[0].Value, &v) != nil {
		return "", nil
	}
	return decodeEmoji(v), nil
}

// decodeEmoji turns Confluence's stored form (hex codepoints like
// "1f9e9" or "1f468-200d-1f4bb") into the emoji itself. Custom-emoji ids
// and anything unparseable are dropped.
func decodeEmoji(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	// Already an emoji character?
	if r := []rune(v); len(r) > 0 && r[0] > 0x2000 {
		return v
	}
	var b strings.Builder
	for _, part := range strings.Split(v, "-") {
		n, err := strconv.ParseInt(part, 16, 32)
		if err != nil || n < 0x20 {
			return ""
		}
		b.WriteRune(rune(n))
	}
	return b.String()
}

// FetchPages pages through every page in the space with storage bodies.
func (c *Client) FetchPages(ctx context.Context, spaceID string, progress func(fetched int)) ([]Page, error) {
	var pages []Page
	next := "/wiki/api/v2/spaces/" + url.PathEscape(spaceID) + "/pages?body-format=storage&limit=50"
	for next != "" {
		var out struct {
			Results []struct {
				ID       json.Number `json:"id"`
				Title    string      `json:"title"`
				ParentID json.Number `json:"parentId"`
				Position *int        `json:"position"`
				OwnerID  string      `json:"ownerId"`
				AuthorID string      `json:"authorId"`
				Version  struct {
					AuthorID string `json:"authorId"`
				} `json:"version"`
				Body struct {
					Storage struct {
						Value string `json:"value"`
					} `json:"storage"`
				} `json:"body"`
			} `json:"results"`
			Links struct {
				Next string `json:"next"`
			} `json:"_links"`
		}
		if err := c.get(ctx, next, &out); err != nil {
			return nil, err
		}
		for _, r := range out.Results {
			pos := len(pages)
			if r.Position != nil {
				pos = *r.Position
			}
			pages = append(pages, Page{
				ID: r.ID.String(), Title: r.Title, ParentID: r.ParentID.String(),
				Position: pos, Body: r.Body.Storage.Value,
				OwnerID: r.OwnerID, AuthorID: r.AuthorID, LastEditorID: r.Version.AuthorID,
			})
		}
		if progress != nil {
			progress(len(pages))
		}
		next = out.Links.Next
	}
	return pages, nil
}
