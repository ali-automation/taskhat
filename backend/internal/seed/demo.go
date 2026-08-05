// Package seed creates and removes the built-in demo dataset: one TaskHat
// space and one DocHat space full of realistic sample content, owned by
// deactivated placeholder users. Everything goes through the normal store
// paths so removal reuses the standard space-delete cleanup (S3 included).
package seed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

const (
	ProjectKey  = "NIMBUS"
	WikiKey     = "NIMBUS"
	UserDomain  = "demo.taskhat.local"
	projectName = "Nimbus Mobile"
	wikiName    = "Nimbus Product Wiki"
)

// WikiKeys lists every DocHat demo space the seeder owns.
var WikiKeys = []string{"NIMBUS", "ORBIT", "LUMEN"}

// ProjectKeys lists every TaskHat demo space the seeder owns.
var ProjectKeys = []string{"NIMBUS", "ORBIT", "LUMEN"}

type Seeder struct {
	St    *store.Store
	Blobs storage.Blob
}

// Present reports whether the demo dataset (either half) exists.
func (s *Seeder) Present(ctx context.Context) (taskhat, dochat bool) {
	for _, k := range ProjectKeys {
		if _, err := s.St.GetProjectByKey(ctx, k); err == nil {
			taskhat = true
			break
		}
	}
	for _, k := range WikiKeys {
		if _, err := s.St.GetWikiSpace(ctx, k); err == nil {
			dochat = true
			break
		}
	}
	return taskhat, dochat
}

// ---- tiny TipTap builders ----

func doc(nodes ...any) []byte {
	b, _ := json.Marshal(map[string]any{"type": "doc", "content": nodes})
	return b
}
func txt(s string, marks ...string) map[string]any {
	n := map[string]any{"type": "text", "text": s}
	if len(marks) > 0 {
		ms := []any{}
		for _, m := range marks {
			ms = append(ms, map[string]any{"type": m})
		}
		n["marks"] = ms
	}
	return n
}
func para(inline ...any) map[string]any {
	return map[string]any{"type": "paragraph", "content": inline}
}
func h2(s string) map[string]any {
	return map[string]any{"type": "heading", "attrs": map[string]any{"level": 2}, "content": []any{txt(s)}}
}
func mention(id, label string) map[string]any {
	return map[string]any{"type": "mention", "attrs": map[string]any{"id": id, "label": label}}
}
func panel(ptype string, inline ...any) map[string]any {
	return map[string]any{"type": "panel", "attrs": map[string]any{"panelType": ptype}, "content": []any{para(inline...)}}
}
func bullets(items ...string) map[string]any {
	lis := []any{}
	for _, it := range items {
		lis = append(lis, map[string]any{"type": "listItem", "content": []any{para(txt(it))}})
	}
	return map[string]any{"type": "bulletList", "content": lis}
}
func tasks(items map[string]bool, order []string) map[string]any {
	lis := []any{}
	for _, label := range order {
		lis = append(lis, map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": items[label]},
			"content": []any{para(txt(label))}})
	}
	return map[string]any{"type": "taskList", "content": lis}
}
func tableOf(rows [][]string) map[string]any {
	trs := []any{}
	for ri, row := range rows {
		cells := []any{}
		cellType := "tableCell"
		if ri == 0 {
			cellType = "tableHeader"
		}
		for _, c := range row {
			cells = append(cells, map[string]any{"type": cellType, "content": []any{para(txt(c))}})
		}
		trs = append(trs, map[string]any{"type": "tableRow", "content": cells})
	}
	return map[string]any{"type": "table", "content": trs}
}
func issueChip(key string) map[string]any {
	return map[string]any{"type": "issueChip", "attrs": map[string]any{"key": key}}
}

func plain(doc []byte) string {
	// Rough text mirror for seeded docs (search only).
	var sb strings.Builder
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		if t, _ := n["text"].(string); t != "" {
			sb.WriteString(t)
			sb.WriteString(" ")
		}
		if kids, ok := n["content"].([]any); ok {
			for _, k := range kids {
				if m, ok := k.(map[string]any); ok {
					walk(m)
				}
			}
		}
	}
	var root map[string]any
	_ = json.Unmarshal(doc, &root)
	walk(root)
	return strings.TrimSpace(sb.String())
}

// 1x1 blue PNG for seeded attachments/screenshots.
var demoPNG = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
	0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0x63, 0x64, 0x60, 0xF8, 0xCF,
	0x00, 0x00, 0x02, 0x04, 0x01, 0x27, 0x0C, 0x28, 0x3E, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
	0x44, 0xAE, 0x42, 0x60, 0x82,
}

// Create builds the whole dataset. ownerID (the admin who clicked the button)
// leads both spaces so nothing is owned by a placeholder.
func (s *Seeder) Create(ctx context.Context, ownerID string) error {
	if th, dh := s.Present(ctx); th || dh {
		return fmt.Errorf("demo data already exists — remove it first")
	}

	// Fictional teammates: deactivated placeholders (they can never log in).
	people := []struct{ email, name string }{
		{"maya@" + UserDomain, "Maya Haddad"},
		{"omar@" + UserDomain, "Omar Nasser"},
		{"lina@" + UserDomain, "Lina Petrova"},
		{"jonas@" + UserDomain, "Jonas Weber"},
	}
	ids := map[string]string{}
	names := map[string]string{}
	for _, p := range people {
		u, err := s.St.SeedPlaceholderUser(ctx, p.email, p.name)
		if err != nil {
			return fmt.Errorf("seed user %s: %w", p.email, err)
		}
		short := strings.SplitN(p.email, "@", 2)[0]
		ids[short] = u.ID
		names[short] = p.name
	}

	if err := s.createTaskhat(ctx, ownerID, ids, names); err != nil {
		return err
	}
	if err := s.createOrbitProject(ctx, ownerID, ids); err != nil {
		return err
	}
	if err := s.createLumenProject(ctx, ownerID, ids); err != nil {
		return err
	}
	if err := s.createDochat(ctx, ownerID, ids, names); err != nil {
		return err
	}
	if err := s.createOrbit(ctx, ownerID, ids, names); err != nil {
		return err
	}
	if err := s.createLumen(ctx, ownerID, ids, names); err != nil {
		return err
	}

	// The read-only demo guest sees both spaces immediately.
	if guest, err := s.St.GetOrCreateDemoUser(ctx); err == nil {
		for _, k := range ProjectKeys {
			if project, err := s.St.GetProjectByKey(ctx, k); err == nil {
				_ = s.St.AddMember(ctx, project.ID, guest.ID, "viewer")
			}
		}
		for _, k := range WikiKeys {
			if space, err := s.St.GetWikiSpace(ctx, k); err == nil {
				_ = s.St.SetWikiSpaceMember(ctx, space.ID, guest.ID, "viewer")
			}
		}
	}
	return nil
}

func (s *Seeder) createTaskhat(ctx context.Context, ownerID string, ids, names map[string]string) error {
	project, err := s.St.CreateProject(ctx, ProjectKey, projectName,
		"Sample space showing everything TaskHat supports — safe to delete from Admin settings.", "scrum", ownerID)
	if err != nil {
		return fmt.Errorf("create project: %w", err)
	}
	for _, id := range ids {
		_ = s.St.AddMember(ctx, project.ID, id, "member")
	}
	// A 4th status makes the board look real.
	if _, err := s.St.AddStatus(ctx, project.ID, project.WorkflowID, "In Review", "in_progress"); err != nil {
		return fmt.Errorf("add status: %w", err)
	}
	statuses, err := s.St.ListStatuses(ctx, project.WorkflowID)
	if err != nil {
		return err
	}
	statusID := map[string]string{}
	for _, st := range statuses {
		statusID[st.Name] = st.ID
	}

	// Components, versions, a space-scoped custom field.
	comp := map[string]string{}
	for _, c := range []struct{ name, desc, lead string }{
		{"Mobile App", "iOS and Android clients", "maya"},
		{"Sync API", "Backend sync + push service", "omar"},
		{"Design System", "Shared UI components", "lina"},
	} {
		lead := ids[c.lead]
		id, err := s.St.CreateComponent(ctx, project.ID, c.name, c.desc, &lead)
		if err != nil {
			return fmt.Errorf("component: %w", err)
		}
		comp[c.name] = id
	}
	rel := func(d int) *time.Time { t := time.Now().AddDate(0, 0, d); return &t }
	v10, err := s.St.CreateVersion(ctx, project.ID, "v1.0", "First public release", rel(-40), rel(-10))
	if err != nil {
		return err
	}
	if _, err := s.St.SetVersionStatus(ctx, v10.ID, "released", nil); err != nil {
		return err
	}
	v11, err := s.St.CreateVersion(ctx, project.ID, "v1.1", "Offline mode and widgets", rel(-9), rel(21))
	if err != nil {
		return err
	}
	platform, err := s.St.CreateCustomField(ctx, &project.ID, "Platform", "select", []string{"iOS", "Android", "Both"})
	if err != nil {
		return err
	}

	// Boards + sprints.
	boards, err := s.St.ListBoards(ctx, project.ID)
	if err != nil || len(boards) == 0 {
		return fmt.Errorf("list boards: %w", err)
	}
	boardID := boards[0].ID
	sprint1, err := s.St.CreateSprint(ctx, boardID)
	if err != nil {
		return err
	}
	if _, err := s.St.StartSprint(ctx, sprint1.ID, "Nimbus Sprint 1", "Ship the v1.0 launch blockers",
		time.Now().AddDate(0, 0, -28), time.Now().AddDate(0, 0, -14)); err != nil {
		return err
	}

	type item struct {
		typ, summary, status, priority, assignee string
		points                                   float64
		labels                                   []string
		parent                                   int // index into created epics, -1 = none
		sprint                                   int // 0 none, 1 done sprint, 2 active sprint
		component                                string
		desc                                     []byte
		estimate                                 int64 // seconds
		platform                                 string
	}
	epicTitles := []string{"Offline mode", "Home screen widgets", "Onboarding revamp"}
	epicIDs := make([]string, len(epicTitles))
	for i, title := range epicTitles {
		e, err := s.St.CreateIssue(ctx, store.NewIssue{
			ProjectID: project.ID, Type: "epic", Summary: title, Priority: "medium", ReporterID: ownerID,
			Description: "Demo epic", DescriptionDoc: doc(
				h2("Goal"),
				para(txt("Deliver "+strings.ToLower(title)+" for the Nimbus mobile app.")),
				panel("info", txt("This is sample data — explore freely, nothing here is real.")),
			),
		})
		if err != nil {
			return fmt.Errorf("epic: %w", err)
		}
		epicIDs[i] = e.ID
	}

	items := []item{
		{"story", "Cache the last 7 days of forecasts on device", "Done", "high", "maya", 5, []string{"mobile", "offline"}, 0, 1, "Mobile App", doc(
			h2("Why"), para(txt("Users lose the forecast the moment they board a plane. ", ""), txt("Offline is our #1 request.", "bold")),
			bullets("Persist normalized forecast JSON", "Evict entries older than 7 days", "Show a stale badge when offline")), 8 * 3600, "Both"},
		{"task", "Background sync every 30 minutes on Wi-Fi", "Done", "medium", "omar", 3, []string{"backend", "offline"}, 0, 1, "Sync API", nil, 4 * 3600, "Android"},
		{"bug", "Widget shows °F after switching the app to metric", "In Review", "high", "lina", 2, []string{"widgets"}, 1, 2, "Mobile App", doc(
			para(txt("Steps to reproduce:")),
			bullets("Set units to metric in Settings", "Add the medium widget", "Widget still renders Fahrenheit"),
			panel("warning", txt("Regression from the 1.0.2 hotfix."))), 2 * 3600, "iOS"},
		{"story", "Medium home-screen widget with hourly strip", "In Progress", "medium", "maya", 8, []string{"widgets", "mobile"}, 1, 2, "Mobile App", nil, 16 * 3600, "Both"},
		{"story", "Interactive onboarding: pick your cities", "To Do", "medium", "jonas", 5, []string{"ux"}, 2, 2, "Design System", nil, 0, "Both"},
		{"task", "A/B test copy for the notification opt-in", "To Do", "low", "lina", 2, []string{"ux"}, 2, 0, "", nil, 0, ""},
		{"bug", "Crash on iPad split view when rotating", "To Do", "highest", "omar", 3, []string{"mobile", "crash"}, -1, 2, "Mobile App", nil, 0, "iOS"},
		{"task", "Rotate push certificates before June", "In Progress", "high", "omar", 1, []string{"backend"}, -1, 2, "Sync API", nil, 3 * 3600, ""},
		{"story", "Severe weather alerts with local notifications", "To Do", "high", "maya", 8, []string{"mobile", "backend"}, -1, 0, "Sync API", nil, 0, "Both"},
		{"task", "Refresh app store screenshots for 1.1", "To Do", "low", "jonas", 1, []string{"ux"}, -1, 0, "", nil, 0, ""},
	}

	issueIDs := make([]string, len(items))
	issueKeys := make([]string, len(items))
	for i, it := range items {
		assignee := ids[it.assignee]
		points := it.points
		n := store.NewIssue{
			ProjectID: project.ID, Type: it.typ, Summary: it.summary, Priority: it.priority,
			AssigneeID: &assignee, ReporterID: ownerID, Labels: it.labels, StoryPoints: &points,
		}
		if it.desc != nil {
			n.Description = plain(it.desc)
			n.DescriptionDoc = it.desc
		}
		if it.parent >= 0 {
			n.ParentID = &epicIDs[it.parent]
		}
		if it.sprint == 2 {
			// active sprint assigned after it exists — see below
		} else if it.sprint == 1 {
			n.SprintID = &sprint1.ID
		}
		issue, err := s.St.CreateIssue(ctx, n)
		if err != nil {
			return fmt.Errorf("issue %q: %w", it.summary, err)
		}
		issueIDs[i] = issue.ID
		issueKeys[i] = issue.Key
		if id, ok := statusID[it.status]; ok && it.status != "To Do" {
			if _, err := s.St.TransitionIssue(ctx, issue.ID, id, ids["maya"]); err != nil {
				return fmt.Errorf("transition %s: %w", issue.Key, err)
			}
		}
		if it.component != "" {
			_ = s.St.ImportUpsertComponent(ctx, project.ID, issue.ID, it.component)
		}
		if it.estimate > 0 {
			est := it.estimate
			_ = s.St.SetIssueEstimates(ctx, issue.ID, true, &est, true, &est)
		}
		if it.platform != "" {
			_ = s.St.ImportSetFieldValue(ctx, issue.ID, platform.ID, "select", it.platform)
		}
		_ = s.St.AddWatcher(ctx, issue.ID, ownerID)
	}

	// Dates on a few items (timeline looks alive).
	start1, due1 := time.Now().AddDate(0, 0, -3), time.Now().AddDate(0, 0, 4)
	_, _ = s.St.UpdateIssue(ctx, issueIDs[3], ownerID, store.IssueUpdate{StartDate: &start1, DueDate: &due1})
	due2 := time.Now().AddDate(0, 0, 10)
	_, _ = s.St.UpdateIssue(ctx, issueIDs[4], ownerID, store.IssueUpdate{DueDate: &due2})

	// Fix versions: shipped work → v1.0, active work → v1.1.
	_, _, _ = s.St.SetIssueFixVersions(ctx, issueIDs[0], []string{v10.ID})
	_, _, _ = s.St.SetIssueFixVersions(ctx, issueIDs[1], []string{v10.ID})
	_, _, _ = s.St.SetIssueFixVersions(ctx, issueIDs[2], []string{v11.ID})
	_, _, _ = s.St.SetIssueFixVersions(ctx, issueIDs[3], []string{v11.ID})

	// Links + comments + worklogs.
	_, _ = s.St.CreateLink(ctx, issueIDs[1], issueIDs[0], "blocks", ownerID)
	_, _ = s.St.CreateLink(ctx, issueIDs[3], issueIDs[2], "relates", ownerID)
	cdoc := doc(para(txt("Field-tested this on a flight yesterday — the stale badge is "),
		txt("exactly", "italic"), txt(" what we needed. Nice work "), mention(ids["maya"], names["maya"]), txt("!")))
	if _, err := s.St.CreateCommentDoc(ctx, issueIDs[0], ids["omar"], plain(cdoc), cdoc); err != nil {
		return fmt.Errorf("comment: %w", err)
	}
	c2 := doc(para(txt("Repro confirmed on iOS 18.4 — the widget timeline provider ignores the unit override. Fix in review.")))
	_, _ = s.St.CreateCommentDoc(ctx, issueIDs[2], ids["lina"], plain(c2), c2)
	c3 := doc(para(txt("Design specs attached. "), mention(ids["jonas"], names["jonas"]), txt(" can you review the empty state?")))
	_, _ = s.St.CreateCommentDoc(ctx, issueIDs[3], ids["maya"], plain(c3), c3)
	_, _ = s.St.AddWorklog(ctx, issueIDs[0], ids["maya"], 6*3600, time.Now().AddDate(0, 0, -16), "Implemented the forecast cache", "auto", nil)
	_, _ = s.St.AddWorklog(ctx, issueIDs[2], ids["lina"], 90*60, time.Now().AddDate(0, 0, -1), "Debugging the unit override", "auto", nil)

	// Attachment on the widget bug.
	blobKey := "demo-" + strings.ToLower(ProjectKey) + "-screenshot"
	if err := s.Blobs.Put(ctx, blobKey, bytes.NewReader(demoPNG), int64(len(demoPNG)), "image/png"); err == nil {
		_, _ = s.St.CreateAttachment(ctx, issueIDs[2], ids["lina"], "widget-units.png", "image/png", int64(len(demoPNG)), blobKey)
	}

	// Close sprint 1 (its issues are Done), start sprint 2 with the active work.
	if _, _, err := s.St.CompleteSprint(ctx, sprint1.ID, nil); err != nil {
		return fmt.Errorf("complete sprint: %w", err)
	}
	sprint2, err := s.St.CreateSprint(ctx, boardID)
	if err != nil {
		return err
	}
	if _, err := s.St.StartSprint(ctx, sprint2.ID, "Nimbus Sprint 2", "Widgets beta + crash fixes",
		time.Now().AddDate(0, 0, -2), time.Now().AddDate(0, 0, 12)); err != nil {
		return err
	}
	for i, it := range items {
		if it.sprint == 2 {
			sid := sprint2.ID
			_, _ = s.St.UpdateIssue(ctx, issueIDs[i], ownerID, store.IssueUpdate{SprintID: &sid, SetSprint: true})
		}
	}
	return nil
}

func (s *Seeder) createDochat(ctx context.Context, ownerID string, ids, names map[string]string) error {
	space, err := s.St.CreateWikiSpace(ctx, WikiKey, wikiName,
		"Sample documentation space — safe to delete from Admin settings.", ownerID)
	if err != nil {
		return fmt.Errorf("create wiki space: %w", err)
	}
	for _, id := range ids {
		_ = s.St.SetWikiSpaceMember(ctx, space.ID, id, "collaborator")
	}

	// Overview (home page).
	home := doc(
		h2("Welcome to Nimbus 🌤"),
		para(txt("Nimbus is a fictional weather app used to demonstrate DocHat. Everything here is sample data.")),
		panel("info", txt("Tip: this wiki is linked to the "), txt("NIMBUS", "bold"), txt(" TaskHat space — work item chips below are live.")),
		h2("Current focus"),
		tasks(map[string]bool{
			"Ship offline mode":        true,
			"Home screen widgets beta": false,
			"Onboarding revamp":        false,
		}, []string{"Ship offline mode", "Home screen widgets beta", "Onboarding revamp"}),
		h2("Team"),
		tableOf([][]string{
			{"Person", "Role", "Focus"},
			{names["maya"], "Mobile lead", "Widgets & offline"},
			{names["omar"], "Backend", "Sync API"},
			{names["lina"], "iOS", "Quality"},
			{names["jonas"], "Design", "Onboarding"},
		}),
	)
	if space.HomePageID != nil {
		_ = s.St.UpdateWikiPage(ctx, *space.HomePageID, "Overview", "🌤", home, plain(home), ownerID)
	}

	mk := func(parent *string, title, icon string, body []byte) (string, error) {
		return s.St.CreateWikiPage(ctx, space.ID, parent, title, icon, "page", body, plain(body), ownerID)
	}
	specsBody := doc(h2("Specs"), para(txt("Product specifications for each Nimbus feature.")))
	specsID, err := mk(nil, "Product specs", "📘", specsBody)
	if err != nil {
		return fmt.Errorf("wiki page: %w", err)
	}
	offline := doc(
		h2("Offline mode"),
		para(txt("Cache the last 7 days of forecasts so the app works without a connection.")),
		panel("success", txt("Shipped in v1.0 — see "), issueChip(ProjectKey+"-4"), txt(" for the implementation story.")),
		h2("Decisions"),
		tableOf([][]string{
			{"Decision", "Owner", "Status"},
			{"SQLite over flat JSON files", names["omar"], "Approved"},
			{"7-day retention window", names["maya"], "Approved"},
		}),
	)
	offlineID, err := mk(&specsID, "Offline mode", "📴", offline)
	if err != nil {
		return err
	}
	widgets := doc(
		h2("Home screen widgets"),
		para(txt("Small, medium and large widgets with the hourly strip. Tracking: "), issueChip(ProjectKey+"-7")),
		bullets("Small: current conditions", "Medium: hourly strip", "Large: 5-day outlook"),
	)
	if _, err := mk(&specsID, "Home screen widgets", "📱", widgets); err != nil {
		return err
	}
	runbookBody := doc(h2("Runbooks"), para(txt("Operations guides for the Nimbus backend.")))
	runbooksID, err := mk(nil, "Runbooks", "🛠", runbookBody)
	if err != nil {
		return err
	}
	oncall := doc(
		h2("Sync API on-call"),
		panel("warning", txt("Page the on-call engineer before restarting the sync workers.")),
		bullets("Check the queue depth dashboard", "Drain one worker at a time", "Verify push delivery after restart"),
	)
	if _, err := mk(&runbooksID, "Sync API on-call", "🚨", oncall); err != nil {
		return err
	}

	// Labels + comments on the offline spec.
	_ = s.St.SetWikiPageLabels(ctx, offlineID, []string{"spec", "shipped"})
	_ = s.St.SetWikiPageLabels(ctx, specsID, []string{"spec"})
	wc := doc(para(txt("Should we bump retention to 14 days for tablets? Storage cost looks fine.")))
	root, err := s.St.CreateWikiComment(ctx, offlineID, ids["lina"], plain(wc), wc, nil, "", 0)
	if err == nil {
		reply := doc(para(txt("Let's measure first — adding it to the 1.2 discussion.")))
		_, _ = s.St.CreateWikiComment(ctx, offlineID, ids["maya"], plain(reply), reply, &root.ID, "", 0)
	}

	// Blog post + whiteboard + calendar.
	blog := doc(
		h2("Nimbus 1.0 is live! 🎉"),
		para(txt("After three sprints we shipped offline mode, a rebuilt forecast engine and a fresh visual design.")),
		para(txt("Huge thanks to "), txt("the whole team", "bold"), txt(" — on to widgets!")),
	)
	if _, err := s.St.CreateWikiPage(ctx, space.ID, nil, "Nimbus 1.0 launch", "🎉", "blog", blog, plain(blog), ownerID); err != nil {
		return err
	}
	wbID, err := s.St.CreateWikiPage(ctx, space.ID, nil, "Architecture sketch", "", "whiteboard", nil, "", ownerID)
	if err != nil {
		return err
	}
	canvas := map[string]any{
		"elements": []any{
			map[string]any{"id": "app", "type": "rectangle", "x": 120, "y": 120, "width": 200, "height": 90,
				"angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#a5d8ff", "fillStyle": "solid",
				"strokeWidth": 2, "roughness": 1, "opacity": 100, "seed": 1, "version": 1, "versionNonce": 1, "isDeleted": false,
				"groupIds": []any{}, "frameId": nil, "boundElements": nil, "updated": 1, "link": nil, "locked": false,
				"strokeStyle": "solid", "roundness": map[string]any{"type": 3}},
			map[string]any{"id": "api", "type": "rectangle", "x": 460, "y": 120, "width": 200, "height": 90,
				"angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#b2f2bb", "fillStyle": "solid",
				"strokeWidth": 2, "roughness": 1, "opacity": 100, "seed": 2, "version": 1, "versionNonce": 2, "isDeleted": false,
				"groupIds": []any{}, "frameId": nil, "boundElements": nil, "updated": 1, "link": nil, "locked": false,
				"strokeStyle": "solid", "roundness": map[string]any{"type": 3}},
			map[string]any{"id": "lbl1", "type": "text", "x": 165, "y": 152, "width": 110, "height": 25,
				"angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
				"strokeWidth": 2, "roughness": 1, "opacity": 100, "seed": 3, "version": 1, "versionNonce": 3, "isDeleted": false,
				"groupIds": []any{}, "frameId": nil, "boundElements": nil, "updated": 1, "link": nil, "locked": false,
				"text": "Nimbus app", "fontSize": 20, "fontFamily": 1, "textAlign": "left", "verticalAlign": "top",
				"baseline": 18, "containerId": nil, "originalText": "Nimbus app", "lineHeight": 1.25},
			map[string]any{"id": "lbl2", "type": "text", "x": 515, "y": 152, "width": 100, "height": 25,
				"angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
				"strokeWidth": 2, "roughness": 1, "opacity": 100, "seed": 4, "version": 1, "versionNonce": 4, "isDeleted": false,
				"groupIds": []any{}, "frameId": nil, "boundElements": nil, "updated": 1, "link": nil, "locked": false,
				"text": "Sync API", "fontSize": 20, "fontFamily": 1, "textAlign": "left", "verticalAlign": "top",
				"baseline": 18, "containerId": nil, "originalText": "Sync API", "lineHeight": 1.25},
		},
		"appState": map[string]any{"viewBackgroundColor": "#ffffff"},
		"files":    map[string]any{},
	}
	cb, _ := json.Marshal(canvas)
	_ = s.St.UpdateWikiCanvas(ctx, wbID, "Architecture sketch", cb, "Nimbus app Sync API", ownerID)

	_, _ = s.St.CreateWikiCalendarEvent(ctx, space.ID, "Sprint 2 review", "Demo of the widgets beta",
		time.Now().AddDate(0, 0, 9), time.Now().AddDate(0, 0, 9), "#357DE8", ownerID)
	_, _ = s.St.CreateWikiCalendarEvent(ctx, space.ID, "v1.1 release window", "Offline + widgets",
		time.Now().AddDate(0, 0, 20), time.Now().AddDate(0, 0, 22), "#22A06B", ownerID)
	return nil
}

// createOrbit seeds the SRE/platform handbook space (ORBIT).
func (s *Seeder) createOrbit(ctx context.Context, ownerID string, ids, names map[string]string) error {
	space, err := s.St.CreateWikiSpace(ctx, "ORBIT", "Orbit Platform Handbook",
		"SRE and platform engineering handbook — sample data.", ownerID)
	if err != nil {
		return fmt.Errorf("create orbit space: %w", err)
	}
	for _, id := range ids {
		_ = s.St.SetWikiSpaceMember(ctx, space.ID, id, "collaborator")
	}
	home := doc(
		h2("Orbit Platform Handbook 🛰"),
		para(txt("How we run the Orbit platform: on-call, incident response, and infrastructure standards.")),
		panel("warning", txt("Production changes require a peer review and a rollback plan — "), txt("no exceptions", "bold"), txt(".")),
		h2("Golden signals"),
		tableOf([][]string{
			{"Signal", "Target", "Alert threshold"},
			{"API latency p99", "< 300 ms", "500 ms for 5 min"},
			{"Error rate", "< 0.1%", "1% for 5 min"},
			{"Queue lag", "< 30 s", "5 min"},
		}),
	)
	if space.HomePageID != nil {
		_ = s.St.UpdateWikiPage(ctx, *space.HomePageID, "Overview", "🛰", home, plain(home), ownerID)
	}
	mk := func(parent *string, title, icon string, body []byte) (string, error) {
		return s.St.CreateWikiPage(ctx, space.ID, parent, title, icon, "page", body, plain(body), ownerID)
	}
	incident := doc(
		h2("Incident response"),
		bullets("Declare in #orbit-incidents with severity", "Incident commander runs the call",
			"Timeline in the incident doc as you go", "Blameless postmortem within 48h"),
		panel("error", txt("SEV1 = customer-facing outage. Page the on-call immediately.")),
	)
	incID, err := mk(nil, "Incident response", "🚨", incident)
	if err != nil {
		return err
	}
	postmortem := doc(
		h2("Postmortem: sync outage on May 12"),
		para(txt("A misconfigured retry storm exhausted the connection pool for 40 minutes.")),
		h2("What we changed"),
		tasks(map[string]bool{
			"Add jitter to client retries":     true,
			"Pool saturation alert":            true,
			"Load-shed non-critical consumers": false,
		}, []string{"Add jitter to client retries", "Pool saturation alert", "Load-shed non-critical consumers"}),
	)
	pmID, err := mk(&incID, "Postmortem: May 12 sync outage", "📋", postmortem)
	if err != nil {
		return err
	}
	deploys := doc(
		h2("Deploys"),
		bullets("Ship behind a flag, enable by cohort", "Canary 5% for 30 minutes before full rollout",
			"Freeze window: Fri 16:00 → Mon 08:00"),
	)
	if _, err := mk(nil, "Deploy guidelines", "🚀", deploys); err != nil {
		return err
	}
	_ = s.St.SetWikiPageLabels(ctx, incID, []string{"runbook", "on-call"})
	_ = s.St.SetWikiPageLabels(ctx, pmID, []string{"postmortem"})
	wc := doc(para(txt("Should load-shedding cover the analytics consumers too? They spiked during the outage.")))
	_, _ = s.St.CreateWikiComment(ctx, pmID, ids["omar"], plain(wc), wc, nil, "", 0)
	return nil
}

// createLumen seeds the design-system space (LUMEN).
func (s *Seeder) createLumen(ctx context.Context, ownerID string, ids, names map[string]string) error {
	space, err := s.St.CreateWikiSpace(ctx, "LUMEN", "Lumen Design System",
		"Design language, components and content guidelines — sample data.", ownerID)
	if err != nil {
		return fmt.Errorf("create lumen space: %w", err)
	}
	for _, id := range ids {
		_ = s.St.SetWikiSpaceMember(ctx, space.ID, id, "collaborator")
	}
	home := doc(
		h2("Lumen Design System ✨"),
		para(txt("One design language across Nimbus apps: tokens, components and voice.")),
		panel("info", txt("Rule of thumb: if you're inventing a new component, "), txt("talk to design first", "bold"), txt(".")),
		h2("Foundations"),
		tableOf([][]string{
			{"Token", "Value", "Use"},
			{"lumen.color.primary", "#357DE8", "Actions, links"},
			{"lumen.color.success", "#22A06B", "Positive states"},
			{"lumen.radius.card", "8 px", "Cards, tiles"},
		}),
	)
	if space.HomePageID != nil {
		_ = s.St.UpdateWikiPage(ctx, *space.HomePageID, "Overview", "✨", home, plain(home), ownerID)
	}
	mk := func(parent *string, title, icon string, body []byte) (string, error) {
		return s.St.CreateWikiPage(ctx, space.ID, parent, title, icon, "page", body, plain(body), ownerID)
	}
	compBody := doc(h2("Components"), para(txt("Specs for every shared component.")))
	compID, err := mk(nil, "Components", "🧩", compBody)
	if err != nil {
		return err
	}
	button := doc(
		h2("Button"),
		bullets("Primary: one per view", "Danger: destructive actions only", "Subtle: secondary actions"),
		panel("success", txt("Buttons say what they do: “Save changes”, never “OK”.")),
	)
	if _, err := mk(&compID, "Button", "🔘", button); err != nil {
		return err
	}
	voice := doc(
		h2("Voice and tone"),
		para(txt("Friendly, direct, never blaming the user.")),
		tableOf([][]string{
			{"Instead of", "Say"},
			{"Invalid input", "That doesn't look like an email address"},
			{"Operation failed", "We couldn't save your changes — try again"},
		}),
	)
	voiceID, err := mk(nil, "Voice and tone", "🗣", voice)
	if err != nil {
		return err
	}
	_ = s.St.SetWikiPageLabels(ctx, compID, []string{"components"})
	_ = s.St.SetWikiPageLabels(ctx, voiceID, []string{"content"})
	wc := doc(para(txt("Can we add an RTL section? Arabic support keeps coming up in reviews.")))
	_, _ = s.St.CreateWikiComment(ctx, voiceID, ids["jonas"], plain(wc), wc, nil, "", 0)
	return nil
}

// seedItem is the compact spec the extra demo spaces are built from.
type seedItem struct {
	typ, summary, status, priority, assignee string
	labels                                   []string
	component                                string
	comment                                  string
	commenter                                string
}

func (s *Seeder) seedProjectItems(ctx context.Context, projectID, workflowID, ownerID string, ids map[string]string, items []seedItem) error {
	statuses, err := s.St.ListStatuses(ctx, workflowID)
	if err != nil {
		return err
	}
	statusID := map[string]string{}
	for _, st := range statuses {
		statusID[st.Name] = st.ID
	}
	for _, it := range items {
		assignee := ids[it.assignee]
		n := store.NewIssue{
			ProjectID: projectID, Type: it.typ, Summary: it.summary, Priority: it.priority,
			ReporterID: ownerID, Labels: it.labels,
		}
		if assignee != "" {
			n.AssigneeID = &assignee
		}
		issue, err := s.St.CreateIssue(ctx, n)
		if err != nil {
			return fmt.Errorf("issue %q: %w", it.summary, err)
		}
		if id, ok := statusID[it.status]; ok && it.status != "To Do" {
			actor := assignee
			if actor == "" {
				actor = ownerID
			}
			if _, err := s.St.TransitionIssue(ctx, issue.ID, id, actor); err != nil {
				return fmt.Errorf("transition %s: %w", issue.Key, err)
			}
		}
		if it.component != "" {
			_ = s.St.ImportUpsertComponent(ctx, projectID, issue.ID, it.component)
		}
		if it.comment != "" {
			cdoc := doc(para(txt(it.comment)))
			_, _ = s.St.CreateCommentDoc(ctx, issue.ID, ids[it.commenter], plain(cdoc), cdoc)
		}
	}
	return nil
}

// createOrbitProject: kanban SRE/platform space pairing with the ORBIT wiki.
func (s *Seeder) createOrbitProject(ctx context.Context, ownerID string, ids map[string]string) error {
	project, err := s.St.CreateProject(ctx, "ORBIT", "Orbit Platform Ops",
		"Platform engineering and SRE work — sample data, safe to delete from Admin settings.", "kanban", ownerID)
	if err != nil {
		return fmt.Errorf("create orbit project: %w", err)
	}
	for _, id := range ids {
		_ = s.St.AddMember(ctx, project.ID, id, "member")
	}
	for _, c := range []struct{ name, desc, lead string }{
		{"Ingress", "Edge, TLS and routing", "omar"},
		{"Postgres", "Databases and backups", "omar"},
		{"Observability", "Metrics, logs, alerts", "lina"},
	} {
		lead := ids[c.lead]
		if _, err := s.St.CreateComponent(ctx, project.ID, c.name, c.desc, &lead); err != nil {
			return fmt.Errorf("orbit component: %w", err)
		}
	}
	if _, err := s.St.CreateCustomField(ctx, &project.ID, "Severity", "select", []string{"SEV1", "SEV2", "SEV3"}); err != nil {
		return err
	}
	items := []seedItem{
		{"bug", "Retry storm exhausts sync API connection pool", "Done", "highest", "omar", []string{"incident"}, "Postgres",
			"Postmortem is in the Orbit wiki — action items tracked here.", "lina"},
		{"task", "Add jitter to client retry backoff", "Done", "high", "omar", []string{"incident", "reliability"}, "Postgres", "", ""},
		{"task", "Alert on connection-pool saturation", "In Progress", "high", "lina", []string{"observability"}, "Observability",
			"Threshold set to 80% for 5 minutes — tuning after a week of data.", "omar"},
		{"task", "Rotate edge TLS certificates", "In Progress", "medium", "omar", []string{"toil"}, "Ingress", "", ""},
		{"story", "Load-shed non-critical queue consumers", "To Do", "high", "omar", []string{"reliability"}, "Postgres", "", ""},
		{"task", "Upgrade ingress controller to v1.12", "To Do", "medium", "jonas", []string{"upgrade"}, "Ingress", "", ""},
		{"task", "Nightly backup restore drill", "To Do", "medium", "", []string{"toil", "backups"}, "Postgres", "", ""},
		{"bug", "Grafana dashboard shows stale queue lag", "To Do", "low", "lina", []string{"observability"}, "Observability", "", ""},
	}
	return s.seedProjectItems(ctx, project.ID, project.WorkflowID, ownerID, ids, items)
}

// createLumenProject: kanban design-system space pairing with the LUMEN wiki.
func (s *Seeder) createLumenProject(ctx context.Context, ownerID string, ids map[string]string) error {
	project, err := s.St.CreateProject(ctx, "LUMEN", "Lumen Design System",
		"Design system components and content work — sample data, safe to delete from Admin settings.", "kanban", ownerID)
	if err != nil {
		return fmt.Errorf("create lumen project: %w", err)
	}
	for _, id := range ids {
		_ = s.St.AddMember(ctx, project.ID, id, "member")
	}
	for _, c := range []struct{ name, desc, lead string }{
		{"Buttons", "Actions and CTAs", "jonas"},
		{"Forms", "Inputs, selects, validation", "maya"},
		{"Icons", "Icon set and guidelines", "jonas"},
	} {
		lead := ids[c.lead]
		if _, err := s.St.CreateComponent(ctx, project.ID, c.name, c.desc, &lead); err != nil {
			return fmt.Errorf("lumen component: %w", err)
		}
	}
	items := []seedItem{
		{"story", "Audit button variants across Nimbus screens", "Done", "medium", "jonas", []string{"audit"}, "Buttons",
			"Found 4 rogue variants — consolidation tasks filed.", "maya"},
		{"task", "Publish spacing and radius tokens", "Done", "medium", "jonas", []string{"tokens"}, "", "", ""},
		{"story", "Dark-mode palette for form controls", "In Progress", "high", "maya", []string{"tokens", "a11y"}, "Forms",
			"Contrast checked at AA — waiting on the disabled-state review.", "jonas"},
		{"task", "RTL guidelines for the docs site", "In Progress", "medium", "lina", []string{"docs", "rtl"}, "", "", ""},
		{"task", "Replace ad-hoc icons with the shared set", "To Do", "medium", "jonas", []string{"icons"}, "Icons", "", ""},
		{"story", "Empty-state illustrations for onboarding", "To Do", "low", "", []string{"illustration"}, "", "", ""},
		{"bug", "Focus ring invisible on dark surfaces", "To Do", "high", "maya", []string{"a11y"}, "Forms", "", ""},
	}
	return s.seedProjectItems(ctx, project.ID, project.WorkflowID, ownerID, ids, items)
}
