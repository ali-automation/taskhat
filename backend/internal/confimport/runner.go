package confimport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/realtime"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// JobConfig lives in import_jobs.config (jsonb); credentials never leave the server.
type JobConfig struct {
	Site      string `json:"site"`
	Email     string `json:"email"`
	Token     string `json:"token"`
	SpaceKey  string `json:"spaceKey"`            // Confluence space to import
	TargetKey string `json:"targetKey,omitempty"` // DocHat space key (defaults to SpaceKey)
}

// Stats matches the shape the import UI already renders.
type Stats struct {
	Phase    string         `json:"phase"`
	Counts   map[string]int `json:"counts"`
	Progress string         `json:"progress,omitempty"`
	Errors   []string       `json:"errors,omitempty"`
}

func snapshotKey(jobID string) string { return "imports/" + jobID + ".json" }

// JobRunner executes Confluence import jobs inside the worker.
type JobRunner struct {
	St    *store.Store
	Blobs storage.Blob
	Hub   *realtime.Hub
	Log   *slog.Logger
}

func (j *JobRunner) Execute(ctx context.Context, jobID, mode string) error {
	job, err := j.St.GetImportJob(ctx, jobID)
	if err != nil {
		return fmt.Errorf("job %s: %w", jobID, err)
	}
	var cfg JobConfig
	if err := json.Unmarshal(job.Config, &cfg); err != nil {
		return j.failJob(ctx, job, fmt.Errorf("bad job config: %w", err))
	}
	switch mode {
	case "scan":
		return j.scan(ctx, job, cfg)
	case "run":
		return j.run(ctx, job, cfg)
	default:
		return fmt.Errorf("unknown import mode %q", mode)
	}
}

func (j *JobRunner) scan(ctx context.Context, job store.ImportJob, cfg JobConfig) error {
	j.setStatus(ctx, job, "scanning", "")
	client := NewClient(cfg.Site, cfg.Email, cfg.Token)
	space, err := client.FetchSpace(ctx, cfg.SpaceKey)
	if err != nil {
		return j.failJob(ctx, job, err)
	}
	pages, err := client.FetchPages(ctx, space.ID, func(n int) {
		j.publish(job, "scanning", Stats{Phase: "fetching", Progress: fmt.Sprintf("%d pages", n)})
	})
	if err != nil {
		return j.failJob(ctx, job, err)
	}

	// Title emojis + attachment listings: one request each per page.
	var attErr error
	for i := range pages {
		if emoji, err := client.FetchPageEmoji(ctx, pages[i].ID); err == nil {
			pages[i].Icon = emoji
		}
		if atts, err := client.FetchAttachments(ctx, pages[i].ID); err == nil {
			pages[i].Attachments = atts
		} else if attErr == nil {
			attErr = err
		}
		if i%25 == 24 {
			p := Stats{Phase: "fetching", Progress: fmt.Sprintf("details %d/%d", i+1, len(pages))}
			// Persisted too, so the polling wizard shows a live counter.
			_ = j.St.SetImportJobStats(ctx, job.ID, p)
			j.publish(job, "scanning", p)
		}
	}

	// Whiteboards never appear in the page listing — enumerate them via CQL,
	// then resolve each for its title and tree position.
	seen := map[string]bool{}
	for _, p := range pages {
		seen[p.ID] = true
	}
	wbIDs, err := client.FetchWhiteboardIDs(ctx, space.Key)
	if err != nil {
		return j.failJob(ctx, job, err)
	}
	for _, id := range wbIDs {
		if seen[id] {
			continue
		}
		if wb, ok, err := client.FetchWhiteboard(ctx, id); err == nil && ok {
			pages = append(pages, wb)
			seen[id] = true
		}
	}

	// Pages inside folders point at parents the page listing doesn't return.
	// Resolve those ids as folders (recursively — folders nest) so the tree
	// keeps its shape; folders become body-less pages in DocHat.
	folders, unresolved, err := resolveFolders(ctx, client, pages, space.HomepageID)
	if err != nil {
		return j.failJob(ctx, job, err)
	}
	pages = append(pages, folders...)

	// Resolve the people behind the pages (owner / creator / last editor) —
	// one request per unique account id.
	users := map[string]User{}
	for _, p := range pages {
		for _, acct := range []string{p.OwnerID, p.AuthorID, p.LastEditorID} {
			if acct == "" {
				continue
			}
			if _, done := users[acct]; done {
				continue
			}
			u, ok, err := client.FetchUser(ctx, acct)
			if err != nil || !ok {
				continue // deleted account or transient error — importer falls back
			}
			users[acct] = u
		}
	}

	data := Data{Space: space, Pages: pages, Users: users}
	raw, err := json.Marshal(data)
	if err != nil {
		return j.failJob(ctx, job, err)
	}
	if err := j.Blobs.Put(ctx, snapshotKey(job.ID), bytes.NewReader(raw), int64(len(raw)), "application/json"); err != nil {
		return j.failJob(ctx, job, err)
	}

	// Dry-run the conversion so the report can call out what gets dropped.
	images, macroSet, attCount := 0, map[string]bool{}, 0
	for _, p := range pages {
		attCount += len(p.Attachments)
		conv, err := Convert(p.Body, nil)
		if err != nil {
			continue
		}
		images += conv.SkippedImages
		for _, m := range conv.SkippedMacros {
			macroSet[m] = true
		}
	}
	nf, nw := 0, 0
	for _, p := range pages {
		if p.IsWhiteboard {
			nw++
		} else if p.IsFolder {
			nf++
		}
	}
	stats := Stats{Phase: "scanned", Counts: map[string]int{"pages": len(pages) - nf - nw}}
	if len(users) > 0 {
		stats.Counts["people"] = len(users)
	}
	if nf > 0 {
		stats.Counts["folders"] = nf
	}
	if nw > 0 {
		stats.Counts["whiteboards"] = nw
	}
	if attErr != nil {
		stats.Errors = append(stats.Errors, fmt.Sprintf("attachment listing failed for some pages (%v) — their files won't import", attErr))
	}
	if len(unresolved) > 0 {
		stats.Errors = append(stats.Errors,
			fmt.Sprintf("%d pages sit under content that isn't a page, folder, or whiteboard (database/embed?) and will land at the top level", len(unresolved)))
	}
	if nw > 0 {
		stats.Errors = append(stats.Errors, "whiteboard contents cannot be read over the API — they import as empty whiteboards")
	}
	if attCount > 0 {
		stats.Counts["attachments"] = attCount
	}
	if images > 0 {
		stats.Counts["inlineImages"] = images
	}
	if len(macroSet) > 0 {
		var names []string
		for m := range macroSet {
			names = append(names, m)
		}
		sort.Strings(names)
		stats.Errors = append(stats.Errors, "unsupported macros will be skipped: "+strings.Join(names, ", "))
	}
	if err := j.St.SetImportJobStats(ctx, job.ID, stats); err != nil {
		return j.failJob(ctx, job, err)
	}
	j.setStatus(ctx, job, "scanned", "")
	j.publish(job, "scanned", stats)
	return nil
}

func (j *JobRunner) run(ctx context.Context, job store.ImportJob, cfg JobConfig) error {
	j.setStatus(ctx, job, "running", "")
	body, err := j.Blobs.Get(ctx, snapshotKey(job.ID))
	if err != nil {
		return j.failJob(ctx, job, fmt.Errorf("scan snapshot missing — run a scan first: %w", err))
	}
	var data Data
	err = json.NewDecoder(body).Decode(&data)
	body.Close()
	if err != nil {
		return j.failJob(ctx, job, err)
	}

	targetKey := strings.ToUpper(strings.TrimSpace(cfg.TargetKey))
	if targetKey == "" {
		targetKey = strings.ToUpper(data.Space.Key)
	}
	space, err := j.St.GetWikiSpace(ctx, targetKey)
	if err != nil {
		space, err = j.St.CreateWikiSpace(ctx, targetKey, data.Space.Name, data.Space.Description, job.OwnerID)
		if err != nil {
			return j.failJob(ctx, job, fmt.Errorf("create wiki space: %w", err))
		}
	}

	// Map Confluence accounts to TaskHat users: existing accounts match by
	// Atlassian account id (shared with Jira imports) or email; unknown
	// people become claimable deactivated placeholders. Unresolvable ids
	// fall back to the importing user.
	userOf := map[string]string{}
	for acct, u := range data.Users {
		if id, err := j.St.ImportUpsertUser(ctx, acct, u.Email, u.DisplayName); err == nil {
			userOf[acct] = id
		}
	}
	creatorOf := func(p Page) string {
		for _, acct := range []string{p.OwnerID, p.AuthorID} {
			if id, ok := userOf[acct]; ok {
				return id
			}
		}
		return job.OwnerID
	}
	editorOf := func(p Page) string {
		if id, ok := userOf[p.LastEditorID]; ok {
			return id
		}
		return creatorOf(p)
	}

	// Parents before children so the tree lands in one pass.
	ordered := orderPages(data.Pages, data.Space.HomepageID)

	client := NewClient(cfg.Site, cfg.Email, cfg.Token)
	stats := Stats{Phase: "loading", Counts: map[string]int{"pages": 0, "updated": 0, "attachments": 0, "inlineImages": 0}}
	idMap := map[string]string{} // Confluence page id → wiki page id
	lastSave := time.Now()
	for i, p := range ordered {
		kind := "page"
		if p.IsFolder {
			kind = "folder"
		} else if p.IsWhiteboard {
			kind = "whiteboard"
		}
		var docRaw []byte
		var bodyText string
		blobCache := map[string][]byte{}   // attachment id → bytes (this page only)
		newImageKey := map[string]string{} // attachment id → public image key minted this run
		if kind == "page" {
			// Inline-able images get their public URLs before conversion.
			imageURL := map[string]string{}
			for _, att := range p.Attachments {
				if !strings.HasPrefix(att.MediaType, "image/") || att.FileSize > maxImportAttachment {
					continue
				}
				if existing, key, err := j.St.WikiAttachmentByConfluenceID(ctx, att.ID); err == nil && existing != "" {
					if key != nil {
						imageURL[att.Title] = "/api/v1/wiki-images/" + *key
					}
					continue
				}
				bin, err := client.Download(ctx, att.DownloadLink, maxImportAttachment)
				if err != nil {
					stats.Errors = append(stats.Errors, fmt.Sprintf("%s / %s: %v", p.Title, att.Title, err))
					continue
				}
				key, err := j.St.CreateWikiImage(ctx, att.MediaType, job.OwnerID)
				if err != nil {
					stats.Errors = append(stats.Errors, fmt.Sprintf("%s / %s: %v", p.Title, att.Title, err))
					continue
				}
				if err := j.Blobs.Put(ctx, "wiki/"+key, bytes.NewReader(bin), int64(len(bin)), att.MediaType); err != nil {
					stats.Errors = append(stats.Errors, fmt.Sprintf("%s / %s: %v", p.Title, att.Title, err))
					continue
				}
				blobCache[att.ID] = bin
				newImageKey[att.ID] = key
				imageURL[att.Title] = "/api/v1/wiki-images/" + key
				stats.Counts["inlineImages"]++
			}
			conv, err := Convert(p.Body, func(fn string) string { return imageURL[fn] })
			if err != nil {
				stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", p.Title, err))
				continue
			}
			docRaw, err = json.Marshal(conv.Doc)
			if err != nil {
				stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", p.Title, err))
				continue
			}
			bodyText = conv.Text
		}

		if p.ID == data.Space.HomepageID && data.Space.HomepageID != "" {
			// The Confluence space homepage becomes the space Overview.
			if space.HomePageID != nil {
				if err := j.St.UpdateWikiPage(ctx, *space.HomePageID, p.Title, p.Icon, docRaw, bodyText, editorOf(p)); err != nil {
					stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", p.Title, err))
					continue
				}
				_ = j.St.SetWikiPageConfluenceID(ctx, *space.HomePageID, p.ID)
				_ = j.St.ImportSetWikiPageAuthors(ctx, *space.HomePageID, creatorOf(p), editorOf(p))
				idMap[p.ID] = *space.HomePageID
				stats.Counts["updated"]++
				j.importAttachments(ctx, client, p, *space.HomePageID, job.OwnerID, blobCache, newImageKey, &stats)
			}
			continue
		}

		var parentID *string
		if pid, ok := idMap[p.ParentID]; ok && p.ParentID != data.Space.HomepageID {
			parentID = &pid
		}
		existing, err := j.St.WikiPageIDByConfluenceID(ctx, space.ID, p.ID)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", p.Title, err))
			continue
		}
		if existing != "" {
			if kind == "page" {
				if err := j.St.UpdateWikiPage(ctx, existing, p.Title, p.Icon, docRaw, bodyText, editorOf(p)); err != nil {
					stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", p.Title, err))
					continue
				}
			}
			_ = j.St.ImportSetWikiPageAuthors(ctx, existing, creatorOf(p), editorOf(p))
			// Heal the tree: earlier imports may have flattened this page.
			if err := j.St.ImportSetWikiPageParent(ctx, existing, parentID, kind); err != nil {
				stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", p.Title, err))
			}
			idMap[p.ID] = existing
			stats.Counts["updated"]++
		} else {
			id, err := j.St.CreateWikiPage(ctx, space.ID, parentID, p.Title, p.Icon, kind, docRaw, bodyText, creatorOf(p))
			if err != nil {
				stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %v", p.Title, err))
				continue
			}
			_ = j.St.SetWikiPageConfluenceID(ctx, id, p.ID)
			_ = j.St.ImportSetWikiPageAuthors(ctx, id, creatorOf(p), editorOf(p))
			idMap[p.ID] = id
			stats.Counts["pages"]++
		}

		if kind == "page" {
			if pageID := idMap[p.ID]; pageID != "" {
				j.importAttachments(ctx, client, p, pageID, job.OwnerID, blobCache, newImageKey, &stats)
			}
		}

		if time.Since(lastSave) > time.Second {
			lastSave = time.Now()
			stats.Progress = fmt.Sprintf("%d/%d", i+1, len(ordered))
			_ = j.St.SetImportJobStats(ctx, job.ID, stats)
			j.publish(job, "running", stats)
		}
	}

	stats.Phase = "done"
	stats.Progress = ""
	if err := j.St.SetImportJobStats(ctx, job.ID, stats); err != nil {
		j.Log.Error("save import stats", "error", err)
	}
	j.setStatus(ctx, job, "done", "")
	j.publish(job, "done", stats)
	return nil
}

// resolveFolders fetches every parent id the page listing didn't return,
// walking up nested folders until the whole ancestry is known.
func resolveFolders(ctx context.Context, client *Client, pages []Page, homeID string) ([]Page, []string, error) {
	known := map[string]bool{"": true, homeID: true}
	for _, p := range pages {
		known[p.ID] = true
	}
	var frontier []string
	seen := map[string]bool{}
	for _, p := range pages {
		if !known[p.ParentID] && !seen[p.ParentID] {
			seen[p.ParentID] = true
			frontier = append(frontier, p.ParentID)
		}
	}
	var folders []Page
	var unresolved []string
	for depth := 0; len(frontier) > 0 && depth < 50; depth++ {
		var next []string
		for _, id := range frontier {
			folder, ok, err := client.FetchFolder(ctx, id)
			if err != nil {
				return nil, nil, fmt.Errorf("resolve folder %s: %w", id, err)
			}
			if !ok {
				// Not a folder — whiteboards sit in the tree too.
				folder, ok, err = client.FetchWhiteboard(ctx, id)
				if err != nil {
					return nil, nil, fmt.Errorf("resolve whiteboard %s: %w", id, err)
				}
			}
			if !ok {
				unresolved = append(unresolved, id)
				continue
			}
			folders = append(folders, folder)
			known[folder.ID] = true
			if !known[folder.ParentID] && !seen[folder.ParentID] {
				seen[folder.ParentID] = true
				next = append(next, folder.ParentID)
			}
		}
		frontier = next
	}
	return folders, unresolved, nil
}

const maxImportAttachment = 20 << 20 // matches the manual upload limit

// importAttachments records a page's attachments (binaries included),
// idempotently by Confluence attachment id. Inline images minted earlier in
// the page pass reuse their downloaded bytes and public key.
func (j *JobRunner) importAttachments(ctx context.Context, client *Client, p Page, pageID, ownerID string, blobCache map[string][]byte, newImageKey map[string]string, stats *Stats) {
	for _, att := range p.Attachments {
		existing, _, err := j.St.WikiAttachmentByConfluenceID(ctx, att.ID)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("%s / %s: %v", p.Title, att.Title, err))
			continue
		}
		if existing != "" {
			continue
		}
		if att.FileSize > maxImportAttachment {
			stats.Errors = append(stats.Errors, fmt.Sprintf("%s: %s skipped (%d MiB > 20 MiB limit)", p.Title, att.Title, att.FileSize>>20))
			continue
		}
		bin, ok := blobCache[att.ID]
		if !ok {
			bin, err = client.Download(ctx, att.DownloadLink, maxImportAttachment)
			if err != nil {
				stats.Errors = append(stats.Errors, fmt.Sprintf("%s / %s: %v", p.Title, att.Title, err))
				continue
			}
		}
		var keyPtr *string
		if k, minted := newImageKey[att.ID]; minted {
			keyPtr = &k
		}
		id, err := j.St.ImportInsertWikiAttachment(ctx, pageID, att.Title, att.MediaType, int64(len(bin)), ownerID, att.ID, keyPtr)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("%s / %s: %v", p.Title, att.Title, err))
			continue
		}
		if err := j.Blobs.Put(ctx, "wiki-att/"+id, bytes.NewReader(bin), int64(len(bin)), att.MediaType); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("%s / %s: %v", p.Title, att.Title, err))
			continue
		}
		stats.Counts["attachments"]++
	}
}

// orderPages sorts parents before children (roots first, then BFS), keeping
// sibling order by position. Orphans land at the end as top-level pages.
func orderPages(pages []Page, homeID string) []Page {
	byParent := map[string][]Page{}
	ids := map[string]bool{}
	for _, p := range pages {
		ids[p.ID] = true
	}
	for _, p := range pages {
		parent := p.ParentID
		if parent == homeID || !ids[parent] {
			parent = "" // top level (includes orphans and homepage children)
		}
		if p.ID == homeID {
			parent = "@home"
		}
		byParent[parent] = append(byParent[parent], p)
	}
	for _, list := range byParent {
		sort.SliceStable(list, func(a, b int) bool { return list[a].Position < list[b].Position })
	}
	var out []Page
	out = append(out, byParent["@home"]...) // homepage first so idMap has it
	queue := append([]Page{}, byParent[""]...)
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		out = append(out, p)
		queue = append(queue, byParent[p.ID]...)
	}
	return out
}

func (j *JobRunner) setStatus(ctx context.Context, job store.ImportJob, status, errMsg string) {
	if err := j.St.SetImportJobStatus(ctx, job.ID, status, errMsg); err != nil {
		j.Log.Error("set import status", "job", job.ID, "error", err)
	}
}

func (j *JobRunner) failJob(ctx context.Context, job store.ImportJob, err error) error {
	j.Log.Error("confluence import failed", "job", job.ID, "error", err)
	j.setStatus(ctx, job, "failed", err.Error())
	j.publish(job, "failed", map[string]string{"error": err.Error()})
	return nil // consumed; don't requeue forever
}

func (j *JobRunner) publish(job store.ImportJob, status string, payload any) {
	if j.Hub == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = j.Hub.Publish(ctx, "user:"+job.OwnerID, "import.progress",
		map[string]any{"jobId": job.ID, "status": status, "stats": payload})
}
