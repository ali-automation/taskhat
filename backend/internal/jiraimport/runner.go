package jiraimport

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/ali-automation/taskhat/backend/internal/rank"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// Stats is persisted to import_jobs.stats and rendered by the UI.
type Stats struct {
	Phase    string         `json:"phase"`
	Counts   map[string]int `json:"counts"`
	Mapping  MappingPreview `json:"mapping"`
	Progress string         `json:"progress,omitempty"`
	Errors   []string       `json:"errors,omitempty"`
}

type MappingPreview struct {
	Types      map[string]string `json:"types"`      // Jira type → TaskHat type
	Statuses   map[string]string `json:"statuses"`   // Jira status → TaskHat status
	Priorities map[string]string `json:"priorities"` // Jira priority → TaskHat priority
	Users      map[string]string `json:"users"`      // display name → matched | placeholder
}

// ScanContext carries what already exists on the site so the dry-run
// report can say "matched"/"new" truthfully.
type ScanContext struct {
	KnownEmails     map[string]bool   // active account emails (lowercase)
	KnownAccountIDs map[string]bool   // users already linked to a Jira account id
	WorkTypes       map[string]string // normalized name → work type key (incl. disabled)
	StatusNames     map[string]bool   // normalized status names in the target workflow
}

// Scan produces the dry-run report for fetched data.
func Scan(data *Data, sc ScanContext) Stats {
	knownEmails := sc.KnownEmails
	stats := Stats{
		Phase: "scanned",
		Counts: map[string]int{
			"issues":  len(data.Issues),
			"sprints": len(data.Sprints),
			"users":   len(data.Users),
		},
		Mapping: MappingPreview{
			Types:      map[string]string{},
			Statuses:   map[string]string{},
			Priorities: map[string]string{},
			Users:      map[string]string{},
		},
	}
	statusLabel := map[string]string{"todo": "To Do", "in_progress": "In Progress", "done": "Done"}
	comments, attachments := 0, 0
	for _, i := range data.Issues {
		comments += len(i.Comments)
		attachments += len(i.Attachments)
		if key, ok := MapTypeStrict(i.Type); ok {
			stats.Mapping.Types[displayOr(i.Type, "(none)")] = key
		} else if key, ok := sc.WorkTypes[normalize(i.Type)]; ok {
			stats.Mapping.Types[i.Type] = key
		} else {
			stats.Mapping.Types[i.Type] = "will be created as a work type"
		}
		if sc.StatusNames[normalize(i.StatusName)] {
			stats.Mapping.Statuses[displayOr(i.StatusName, "(none)")] = i.StatusName
		} else if i.StatusName == "" {
			stats.Mapping.Statuses["(none)"] = statusLabel[MapStatusCategory(i.StatusCategory, i.StatusName)]
		} else {
			stats.Mapping.Statuses[i.StatusName] = fmt.Sprintf("will be created (%s)",
				statusLabel[MapStatusCategory(i.StatusCategory, i.StatusName)])
		}
		stats.Mapping.Priorities[displayOr(i.Priority, "(none)")] = MapPriority(i.Priority)
	}
	stats.Counts["comments"] = comments
	stats.Counts["attachments"] = attachments
	matched := 0
	for _, u := range data.Users {
		name := displayOr(u.DisplayName, u.Email)
		switch {
		case u.Email != "" && knownEmails[strings.ToLower(u.Email)]:
			stats.Mapping.Users[name] = "matched by email"
			matched++
		case u.AccountID != "" && sc.KnownAccountIDs[u.AccountID]:
			stats.Mapping.Users[name] = "matched by Jira account"
			matched++
		default:
			stats.Mapping.Users[name] = "placeholder account"
		}
	}
	stats.Counts["usersMatched"] = matched
	return stats
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func displayOr(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// changelogNoise lists Jira-internal changelog fields that Jira's own
// History tab never shows raw (time tracking bookkeeping in seconds).
var changelogNoise = map[string]bool{
	"worklogid": true, "workratio": true, "rank": true,
}

// timeFieldLabels renames Jira's internal time-tracking changelog fields to
// the labels Jira displays; values convert from raw seconds to durations.
var timeFieldLabels = map[string]string{
	"timespent": "time spent", "timeestimate": "remaining estimate",
	"timeoriginalestimate": "original estimate",
}

func historyValue(field, v string) string {
	if _, ok := timeFieldLabels[field]; !ok || v == "" {
		return v
	}
	var n int64
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
		return v
	}
	return store.FormatJiraDuration(n)
}

// Runner loads normalized data into TaskHat.
type Runner struct {
	St       *store.Store
	Blobs    storage.Blob
	Client   *Client // nil for CSV imports (no attachment downloads)
	Log      *slog.Logger
	Progress func(Stats)
}

// Load runs the phased, idempotent import. ownerID becomes lead of a newly
// created project and the fallback author/reporter.
func (r *Runner) Load(ctx context.Context, data *Data, ownerID string) (Stats, error) {
	stats := Stats{Counts: map[string]int{}}
	report := func(phase, progress string) {
		stats.Phase = phase
		stats.Progress = progress
		if r.Progress != nil {
			r.Progress(stats)
		}
	}
	fail := func(phase string, err error) (Stats, error) {
		return stats, fmt.Errorf("%s: %w", phase, err)
	}
	addErr := func(context string, err error) {
		msg := context + ": " + err.Error()
		r.Log.Error("import item failed", "error", msg)
		if len(stats.Errors) < 50 {
			stats.Errors = append(stats.Errors, msg)
		}
		stats.Counts["failed"]++
	}

	// Phase 1: project + status mapping.
	report("project", "")
	projectType := "kanban"
	if len(data.Sprints) > 0 {
		projectType = "scrum"
	}
	project, err := r.St.ImportEnsureProject(ctx, data.Project.Key, data.Project.Name, projectType, ownerID)
	if err != nil {
		return fail("project", err)
	}
	statuses, err := r.St.ListStatuses(ctx, project.WorkflowID)
	if err != nil {
		return fail("statuses", err)
	}
	statusByCategory := map[string]string{}
	statusByName := map[string]string{}
	for _, st := range statuses {
		statusByCategory[st.Category] = st.ID
		statusByName[normalize(st.Name)] = st.ID
	}
	// Create the real Jira statuses in this space's workflow (name-matched,
	// idempotent) instead of collapsing everything onto the default three.
	for _, issue := range data.Issues {
		name := strings.TrimSpace(issue.StatusName)
		if name == "" || statusByName[normalize(name)] != "" {
			continue
		}
		st, err := r.St.AddStatus(ctx, project.ID, project.WorkflowID, name,
			MapStatusCategory(issue.StatusCategory, issue.StatusName))
		if err != nil {
			addErr("status "+name, err)
			continue
		}
		statusByName[normalize(name)] = st.ID
		stats.Counts["statusesCreated"]++
	}

	// Custom Jira issue types become custom work types (site-wide, like Jira).
	workTypes, err := r.St.ListWorkTypes(ctx, true)
	if err != nil {
		return fail("work types", err)
	}
	typeKeyByName := map[string]string{}
	for _, wt := range workTypes {
		typeKeyByName[normalize(wt.Name)] = wt.Key
		typeKeyByName[normalize(wt.Key)] = wt.Key
	}
	typeOf := func(jiraType string) string {
		if key, ok := MapTypeStrict(jiraType); ok {
			return key
		}
		if key, ok := typeKeyByName[normalize(jiraType)]; ok {
			return key
		}
		wt, err := r.St.CreateWorkType(ctx, strings.TrimSpace(jiraType), "task", "#8590A2")
		if err != nil {
			addErr("work type "+jiraType, err)
			return "task"
		}
		typeKeyByName[normalize(jiraType)] = wt.Key
		stats.Counts["workTypesCreated"]++
		return wt.Key
	}
	boards, err := r.St.ListBoards(ctx, project.ID)
	if err != nil || len(boards) == 0 {
		return fail("board", fmt.Errorf("project board missing: %v", err))
	}
	board := boards[0]

	// Space avatar from Jira's project icon — only when none is set, so a
	// hand-picked TaskHat avatar is never clobbered.
	if len(data.AvatarBytes) > 0 && project.AvatarURL == nil && r.Blobs != nil {
		key := uuid.NewString()
		mime := data.AvatarMime
		if mime == "" {
			mime = "image/png"
		}
		if err := r.Blobs.Put(ctx, key, bytes.NewReader(data.AvatarBytes), int64(len(data.AvatarBytes)), mime); err == nil {
			if _, err := r.St.SetProjectImage(ctx, project.ID, &key); err != nil {
				addErr("space avatar", err)
			}
		}
	}

	// Recreate Jira's board layout when the scan captured it: columns in
	// Jira's order, each with its mapped statuses (e.g. Backlog inside the
	// "To Do" column). Statuses Jira leaves off the board get their own
	// trailing columns so nothing silently disappears.
	appliedLayout := false
	if len(data.BoardColumns) > 0 {
		if fresh, err := r.St.ListStatuses(ctx, project.WorkflowID); err == nil {
			idByName := map[string]string{}
			catRank := map[string]int{"todo": 0, "in_progress": 1, "done": 2}
			type leftover struct {
				id   string
				name string
				rank int
			}
			var rest []leftover
			mapped := map[string]bool{}
			for _, st := range fresh {
				idByName[normalize(st.Name)] = st.ID
			}
			var cols []store.ImportBoardColumn
			for _, jc := range data.BoardColumns {
				col := store.ImportBoardColumn{Name: jc.Name}
				for _, sn := range jc.StatusNames {
					if id := idByName[normalize(sn)]; id != "" && !mapped[id] {
						col.StatusIDs = append(col.StatusIDs, id)
						mapped[id] = true
					}
				}
				cols = append(cols, col)
			}
			colByName := map[string]int{}
			for i2, c := range cols {
				colByName[normalize(c.Name)] = i2
			}
			for _, st := range fresh {
				if !mapped[st.ID] {
					// A leftover status whose name matches an existing column
					// joins it (e.g. the default "To Do" status merges into
					// Jira's "To Do" column) — never two same-named columns.
					if i2, ok := colByName[normalize(st.Name)]; ok {
						cols[i2].StatusIDs = append(cols[i2].StatusIDs, st.ID)
						continue
					}
					rest = append(rest, leftover{st.ID, st.Name, catRank[st.Category]})
				}
			}
			sort.SliceStable(rest, func(a, b int) bool { return rest[a].rank < rest[b].rank })
			for _, lo := range rest {
				cols = append(cols, store.ImportBoardColumn{Name: lo.name, StatusIDs: []string{lo.id}})
			}
			if err := r.St.ImportSetBoardColumns(ctx, board.ID, cols); err != nil {
				addErr("board layout", err)
			} else {
				appliedLayout = true
				if data.BoardName != "" {
					_ = r.St.ImportRenameBoard(ctx, board.ID, data.BoardName)
				}
			}
		}
	}

	// New status columns get appended at the end of the board; reorder by
	// workflow category (to-do → in-progress → done) so "Backlog" sits with
	// To Do instead of hiding past the Done column.
	if !appliedLayout && stats.Counts["statusesCreated"] > 0 {
		if fresh, err := r.St.ListStatuses(ctx, project.WorkflowID); err == nil {
			catRank := map[string]int{"todo": 0, "in_progress": 1, "done": 2}
			rankOfStatus := map[string]int{}
			for _, st := range fresh {
				rankOfStatus[st.ID] = catRank[st.Category]
			}
			if b, err := r.St.GetBoard(ctx, board.ID); err == nil {
				cols := b.Columns
				sort.SliceStable(cols, func(a, bb int) bool {
					ra, rb := 1, 1
					if len(cols[a].StatusIDs) > 0 {
						ra = rankOfStatus[cols[a].StatusIDs[0]]
					}
					if len(cols[bb].StatusIDs) > 0 {
						rb = rankOfStatus[cols[bb].StatusIDs[0]]
					}
					return ra < rb
				})
				ids := make([]string, len(cols))
				for i2, c := range cols {
					ids[i2] = c.ID
				}
				if err := r.St.ReorderColumns(ctx, board.ID, ids); err != nil {
					addErr("column order", err)
				}
			}
		}
	}


	// Phase 2: users.
	report("users", "")
	userIDs := map[string]string{} // account key → user id
	for key, u := range data.Users {
		id, err := r.St.ImportUpsertUser(ctx, u.AccountID, strings.ToLower(u.Email), u.DisplayName)
		if err != nil {
			addErr("user "+u.DisplayName, err)
			continue
		}
		userIDs[key] = id
		stats.Counts["users"]++
	}

	// Rich-text conversion resolves @mentions to imported accounts.
	adfOpts := ADFOptions{ResolveMention: func(acct string) (string, string, bool) {
		if id, ok := userIDs[acct]; ok && acct != "" {
			return id, displayOr(data.Users[acct].DisplayName, "user"), true
		}
		return "", "", false
	}}

	// Phase 3: sprints.
	report("sprints", "")
	sprintIDByIssueKey := map[string]string{}
	for _, sp := range data.Sprints {
		id, err := r.St.ImportUpsertSprint(ctx, board.ID, sp.Name, sp.State, sp.StartAt, sp.EndAt, sp.CompletedAt)
		if err != nil {
			addErr("sprint "+sp.Name, err)
			continue
		}
		stats.Counts["sprints"]++
		for _, key := range sp.IssueKeys {
			// prefer non-closed sprint membership when an issue appears twice
			if existing, ok := sprintIDByIssueKey[key]; !ok || sp.State != "closed" || existing == "" {
				sprintIDByIssueKey[key] = id
			}
		}
	}

	// Phase 4: issues in source order (preserves Jira ordering as rank order).
	currentRank, err := r.St.MaxRank(ctx, project.ID)
	if err != nil {
		return fail("rank", err)
	}
	var maxNumber int64
	issueIDByKey := map[string]string{}
	createdNow := map[string]bool{}
	for n, issue := range data.Issues {
		if n%25 == 0 {
			report("issues", fmt.Sprintf("%d/%d", n, len(data.Issues)))
		}
		nextRank, err := rank.After(currentRank)
		if err != nil {
			return fail("rank", err)
		}
		currentRank = nextRank

		reporterID := userIDs[issue.ReporterAcct]
		if reporterID == "" {
			reporterID = ownerID
		}
		var assigneeID *string
		if id, ok := userIDs[issue.AssigneeAcct]; ok && issue.AssigneeAcct != "" {
			assigneeID = &id
		}
		var sprintID *string
		if id, ok := sprintIDByIssueKey[issue.Key]; ok {
			sprintID = &id
		}
		descDoc := ADFToDoc(issue.DescriptionADF, adfOpts)
		row := store.ImportIssueRow{
			DescriptionDoc: descDoc,
			Number:      issue.Number,
			JiraID:      issue.JiraID,
			JiraKey:     issue.Key,
			Type:        typeOf(issue.Type),
			Summary:     issue.Summary,
			Description: issue.Description,
			StatusID: firstNonEmpty(statusByName[normalize(issue.StatusName)],
				statusByCategory[MapStatusCategory(issue.StatusCategory, issue.StatusName)]),
			Priority:    MapPriority(issue.Priority),
			AssigneeID:  assigneeID,
			ReporterID:  reporterID,
			Labels:      issue.Labels,
			StoryPoints: issue.StoryPoints,
			OriginalEstimateSeconds:  issue.OriginalEstimateSeconds,
			RemainingEstimateSeconds: issue.RemainingEstimateSeconds,
			SprintID:    sprintID,
			StartDate:   issue.StartDate,
			DueDate:     issue.DueDate,
			CreatedAt:   issue.CreatedAt,
			UpdatedAt:   issue.UpdatedAt,
			ResolvedAt:  issue.ResolvedAt,
			Rank:        nextRank,
		}
		id, inserted, err := r.St.ImportUpsertIssue(ctx, project.ID, row)
		if err != nil {
			addErr("issue "+issue.Key, err)
			continue
		}
		issueIDByKey[issue.Key] = id
		if inserted {
			stats.Counts["issuesCreated"]++
			createdNow[issue.Key] = true
		} else {
			stats.Counts["issuesUpdated"]++
		}
		if issue.Number > maxNumber {
			maxNumber = issue.Number
		}
	}
	if err := r.St.ImportBumpSeq(ctx, project.ID, maxNumber); err != nil {
		return fail("sequence", err)
	}

	// Repair pass: earlier imports recorded raw time-tracking bookkeeping.
	if err := r.St.ImportCleanHistory(ctx, project.ID); err != nil {
		addErr("history cleanup", err)
	}
	// Repair pass: earlier imports stored site-specific story-point fields
	// ("Story point estimate") as custom fields; they now feed the native one.
	if err := r.St.ImportRetireCustomFields(ctx, project.ID,
		[]string{"story points", "story point estimate", "story points estimate", "start date"}); err != nil {
		addErr("story-point field cleanup", err)
	}

	// Phase 5: parent / epic links (all issues now exist).
	report("links", "")
	for _, issue := range data.Issues {
		if issue.ParentKey == "" {
			continue
		}
		childID, ok1 := issueIDByKey[issue.Key]
		parentID, ok2 := issueIDByKey[issue.ParentKey]
		if !ok1 || !ok2 {
			continue
		}
		if err := r.St.ImportSetParent(ctx, childID, parentID); err != nil {
			addErr("parent "+issue.Key, err)
			continue
		}
		stats.Counts["links"]++
	}

	// Phase 6: comments.
	report("comments", "")
	for _, issue := range data.Issues {
		issueID, ok := issueIDByKey[issue.Key]
		if !ok {
			continue
		}
		for _, c := range issue.Comments {
			authorID := userIDs[c.AuthorAcct]
			if authorID == "" {
				authorID = ownerID
			}
			inserted, err := r.St.ImportUpsertComment(ctx, issueID, authorID, c.Body, ADFToDoc(c.BodyADF, adfOpts), c.CreatedAt, c.JiraID)
			if err != nil {
				addErr("comment on "+issue.Key, err)
				continue
			}
			if inserted {
				stats.Counts["comments"]++
			}
		}
	}

	// Phase 6b: relationships and trimmings — links, releases, components,
	// worklogs, watchers, custom values; history only for newly created items.
	report("details", "")
	versionIDs := map[string]string{}
	fieldIDs := map[string]string{} // jira custom id → taskhat field id
	for _, def := range data.CustomFields {
		if id, err := r.St.ImportEnsureCustomField(ctx, project.ID, def.Name, def.Type); err == nil {
			fieldIDs[def.JiraID] = id
		}
	}
	for _, issue := range data.Issues {
		issueID, ok := issueIDByKey[issue.Key]
		if !ok {
			continue
		}
		for _, l := range issue.Links {
			otherID, ok := issueIDByKey[l.OtherKey]
			if !ok {
				continue
			}
			linkType := "relates"
			switch strings.ToLower(l.TypeName) {
			case "blocks":
				linkType = "blocks"
			case "duplicate", "duplicates", "cloners":
				linkType = "duplicates"
			}
			if _, err := r.St.CreateLink(ctx, issueID, otherID, linkType, ownerID); err == nil {
				stats.Counts["links"]++
			}
		}
		for _, vn := range issue.FixVersions {
			vid, ok := versionIDs[vn]
			if !ok {
				var err error
				if vid, err = r.St.ImportUpsertVersion(ctx, project.ID, vn); err != nil {
					addErr("version "+vn, err)
					continue
				}
				versionIDs[vn] = vid
			}
			if err := r.St.ImportAddIssueFixVersion(ctx, issueID, vid); err == nil {
				stats.Counts["fixVersions"]++
			}
		}
		for _, comp := range issue.Components {
			if err := r.St.ImportUpsertComponent(ctx, project.ID, issueID, comp); err == nil {
				stats.Counts["components"]++
			}
		}
		for _, w := range issue.Worklogs {
			authorID := userIDs[w.AuthorAcct]
			if authorID == "" {
				authorID = ownerID
			}
			if w.Seconds <= 0 || w.StartedAt == nil {
				continue
			}
			if inserted, err := r.St.ImportUpsertWorklog(ctx, issueID, authorID, w.Seconds, *w.StartedAt, w.Comment, w.JiraID); err != nil {
				addErr("worklog on "+issue.Key, err)
			} else if inserted {
				stats.Counts["worklogs"]++
			}
		}
		for _, acct := range issue.Watchers {
			if uid, ok := userIDs[acct]; ok {
				if err := r.St.ImportAddWatcher(ctx, issueID, uid); err == nil {
					stats.Counts["watchers"]++
				}
			}
		}
		for jiraField, value := range issue.Custom {
			fid, ok := fieldIDs[jiraField]
			if !ok {
				continue
			}
			ftype := ""
			for _, def := range data.CustomFields {
				if def.JiraID == jiraField {
					ftype = def.Type
					break
				}
			}
			if err := r.St.ImportSetFieldValue(ctx, issueID, fid, ftype, value); err != nil {
				addErr("field on "+issue.Key, err)
			} else {
				stats.Counts["customValues"]++
			}
		}
		// History: once, when the issue was first created here — re-imports
		// would duplicate rows otherwise (no provenance on events).
		if createdNow[issue.Key] {
			for _, h := range issue.History {
			field := strings.ToLower(h.Field)
			if changelogNoise[field] {
				continue
			}
			oldV, newV := historyValue(field, h.From), historyValue(field, h.To)
			if label, ok := timeFieldLabels[field]; ok {
				field = label
			}
			h.Field, h.From, h.To = field, oldV, newV
				actorID := userIDs[h.AuthorAcct]
				if actorID == "" {
					actorID = ownerID
				}
				if h.CreatedAt == nil {
					continue
				}
				if err := r.St.ImportInsertEvent(ctx, issueID, actorID, h.Field, h.From, h.To, *h.CreatedAt); err == nil {
					stats.Counts["historyEvents"]++
				}
			}
		}
	}

	// Phase 7: attachments (API imports only — CSV has no binaries).
	if r.Client != nil {
		report("attachments", "")
		for _, issue := range data.Issues {
			issueID, ok := issueIDByKey[issue.Key]
			if !ok {
				continue
			}
			for _, a := range issue.Attachments {
				exists, err := r.St.AttachmentExistsByJiraID(ctx, a.JiraID)
				if err != nil || exists {
					continue
				}
				body, size, err := r.Client.Download(ctx, a.ContentURL)
				if err != nil {
					addErr("attachment "+a.Filename, err)
					continue
				}
				if size < 0 {
					size = a.Size
				}
				storageKey := uuid.NewString()
				putErr := r.Blobs.Put(ctx, storageKey, body, size, a.Mime)
				body.Close()
				if putErr != nil {
					addErr("attachment "+a.Filename, putErr)
					continue
				}
				uploaderID := userIDs[a.AuthorAcct]
				if uploaderID == "" {
					uploaderID = ownerID
				}
				// Record the actual streamed size — Jira's reported size can
				// drift, and Content-Length mismatches break downloads.
				if err := r.St.ImportInsertAttachment(ctx, issueID, uploaderID, a.Filename, a.Mime, size, storageKey, a.JiraID); err != nil {
					addErr("attachment "+a.Filename, err)
					continue
				}
				stats.Counts["attachments"]++
			}
		}
	}

	stats.Phase = "done"
	sort.Strings(stats.Errors)
	if r.Progress != nil {
		r.Progress(stats)
	}
	return stats, nil
}
