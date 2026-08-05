package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/mailer"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// publishAsAutomation re-broadcasts a mutation so notifications, webhooks and
// live boards behave exactly as if a user had done it — attributed to the
// automation actor (which is what loop prevention keys on).
func (e *Engine) publishAsAutomation(ctx context.Context, eventType string, issue store.Issue) {
	body, err := json.Marshal(issue)
	if err != nil {
		return
	}
	if e.publisher != nil {
		_ = e.publisher.Publish(ctx, events.Event{
			Type: eventType, ActorID: e.actor(ctx), OccurredAt: time.Now().UTC(), Payload: body,
		})
	}
	if e.hub != nil {
		_ = e.hub.Publish(ctx, "project:"+issue.ProjectKey, eventType, issue)
	}
}

func (e *Engine) runAction(ctx context.Context, rule store.AutomationRule, c Component, issue store.Issue, ev events.Event, rs *runState) error {
	actor := e.actor(ctx)
	label := "action:" + c.Type
	sv := e.smartValues(ctx, issue, ev, rs)

	switch c.Type {
	case "transition":
		var cfg struct {
			StatusName string `json:"statusName"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		if issue.ID == "" {
			return fmt.Errorf("no work item in context")
		}
		statusID, err := e.st.StatusIDByName(ctx, issue.WorkflowID, cfg.StatusName)
		if err != nil {
			return fmt.Errorf("status %q not in %s's workflow", cfg.StatusName, issue.ProjectKey)
		}
		updated, err := e.st.TransitionIssue(ctx, issue.ID, statusID, actor)
		if err != nil {
			return fmt.Errorf("transition to %q: %w", cfg.StatusName, err)
		}
		e.publishAsAutomation(ctx, "issue.transitioned", updated)
		rs.add(label, issue.Key, "done", "→ "+cfg.StatusName)
		return nil

	case "edit": // edit fields
		var cfg struct {
			Assignee     *string  `json:"assignee"` // email | "reporter" | "space-lead" | "" (unassign)
			Priority     *string  `json:"priority"`
			AddLabels    []string `json:"addLabels"`
			RemoveLabels []string `json:"removeLabels"`
			DueInDays    *int     `json:"dueInDays"` // nil = untouched; -1 clears
		}
		_ = json.Unmarshal(c.Config, &cfg)
		if issue.ID == "" {
			return fmt.Errorf("no work item in context")
		}
		upd := store.IssueUpdate{}
		details := []string{}
		if cfg.Assignee != nil {
			upd.SetAssignee = true
			switch *cfg.Assignee {
			case "":
				details = append(details, "unassigned")
			case "reporter":
				upd.AssigneeID = &issue.Reporter.ID
				details = append(details, "assignee=reporter")
			case "space-lead":
				project, err := e.st.GetProjectByKey(ctx, issue.ProjectKey)
				if err != nil {
					return err
				}
				upd.AssigneeID = &project.Lead.ID
				details = append(details, "assignee=space lead")
			default:
				user, _, err := e.st.GetUserForLogin(ctx, strings.ToLower(*cfg.Assignee))
				if err != nil {
					return fmt.Errorf("assignee %q not found", *cfg.Assignee)
				}
				upd.AssigneeID = &user.ID
				details = append(details, "assignee="+user.DisplayName)
			}
		}
		if cfg.Priority != nil && *cfg.Priority != "" {
			p := strings.ToLower(*cfg.Priority)
			upd.Priority = &p
			details = append(details, "priority="+p)
		}
		if len(cfg.AddLabels) > 0 || len(cfg.RemoveLabels) > 0 {
			labels := map[string]bool{}
			for _, l := range issue.Labels {
				labels[l] = true
			}
			for _, l := range cfg.AddLabels {
				labels[strings.ToLower(render(l, sv))] = true
			}
			for _, l := range cfg.RemoveLabels {
				delete(labels, strings.ToLower(l))
			}
			next := []string{}
			for l := range labels {
				next = append(next, l)
			}
			upd.Labels = &next
			details = append(details, "labels updated")
		}
		if cfg.DueInDays != nil {
			if *cfg.DueInDays < 0 {
				upd.ClearDue = true
				details = append(details, "due date cleared")
			} else {
				due := time.Now().AddDate(0, 0, *cfg.DueInDays)
				upd.DueDate = &due
				details = append(details, "due in "+fmt.Sprint(*cfg.DueInDays)+"d")
			}
		}
		updated, err := e.st.UpdateIssue(ctx, issue.ID, actor, upd)
		if err != nil {
			return err
		}
		e.publishAsAutomation(ctx, "issue.updated", updated)
		rs.add(label, issue.Key, "done", strings.Join(details, ", "))
		return nil

	case "comment":
		var cfg struct {
			Body string `json:"body"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		if issue.ID == "" {
			return fmt.Errorf("no work item in context")
		}
		if _, err := e.st.CreateComment(ctx, issue.ID, actor, render(cfg.Body, sv)); err != nil {
			return err
		}
		rs.add(label, issue.Key, "done", "")
		return nil

	case "email":
		var cfg struct {
			To      string `json:"to"` // email | "assignee" | "reporter"
			Subject string `json:"subject"`
			Body    string `json:"body"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		to := render(cfg.To, sv)
		switch cfg.To {
		case "assignee":
			if issue.Assignee == nil {
				rs.add(label, issue.Key, "skipped", "no assignee")
				return nil
			}
			to = issue.Assignee.Email
		case "reporter":
			to = issue.Reporter.Email
		}
		smtp := e.smtp(ctx)
		if !smtp.Enabled() {
			return fmt.Errorf("no SMTP server configured")
		}
		if err := mailer.Send(smtp, to, render(cfg.Subject, sv), render(cfg.Body, sv)+"\r\n"); err != nil {
			return err
		}
		rs.add(label, issue.Key, "done", "→ "+to)
		return nil

	case "webrequest":
		var cfg struct {
			URL    string `json:"url"`
			Secret string `json:"secret"`
			Body   string `json:"body"` // optional custom body; default = item JSON
		}
		_ = json.Unmarshal(c.Config, &cfg)
		body := []byte(render(cfg.Body, sv))
		if cfg.Body == "" {
			body, _ = json.Marshal(map[string]any{"rule": rule.Name, "event": ev.Type, "data": issue})
		}
		status, errMsg := e.postSigned(ctx, render(cfg.URL, sv), cfg.Secret, ev.Type, body)
		if status < 200 || status >= 300 {
			return fmt.Errorf("web request: HTTP %d %s", status, errMsg)
		}
		rs.add(label, issue.Key, "done", fmt.Sprintf("HTTP %d", status))
		return nil

	case "create":
		var cfg struct {
			ProjectKey string `json:"projectKey"` // empty = same space
			Type       string `json:"type"`
			Summary    string `json:"summary"`
			Descr      string `json:"description"`
			Priority   string `json:"priority"`
			SameParent bool   `json:"sameParent"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		projectKey := cfg.ProjectKey
		if projectKey == "" {
			projectKey = issue.ProjectKey
		}
		project, err := e.st.GetProjectByKey(ctx, strings.ToUpper(projectKey))
		if err != nil {
			return fmt.Errorf("space %q not found", projectKey)
		}
		newIssue := store.NewIssue{
			ProjectID:   project.ID,
			Type:        orDefault(strings.ToLower(cfg.Type), "task"),
			Summary:     render(cfg.Summary, sv),
			Description: render(cfg.Descr, sv),
			Priority:    orDefault(strings.ToLower(cfg.Priority), "medium"),
			ReporterID:  actor,
		}
		if cfg.SameParent && issue.Parent != nil && project.ID == issue.ProjectID {
			newIssue.ParentID = &issue.Parent.ID
		}
		created, err := e.st.CreateIssue(ctx, newIssue)
		if err != nil {
			return err
		}
		rs.created = &created
		e.publishAsAutomation(ctx, "issue.created", created)
		rs.add(label, created.Key, "done", created.Key+" created")
		return nil

	case "create_wiki_page":
		var cfg struct {
			SpaceKey string `json:"spaceKey"`
			Title    string `json:"title"`
			Body     string `json:"body"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		space, err := e.st.GetWikiSpace(ctx, strings.ToUpper(cfg.SpaceKey))
		if err != nil {
			return fmt.Errorf("wiki space %q not found", cfg.SpaceKey)
		}
		title := strings.TrimSpace(render(cfg.Title, sv))
		if title == "" {
			return fmt.Errorf("page title required")
		}
		body := render(cfg.Body, sv)
		pageID, err := e.st.CreateWikiPage(ctx, space.ID, nil, title, "", "page", textToDoc(body), body, actor)
		if err != nil {
			return err
		}
		rs.add(label, title, "done", "page created in "+space.Key)
		_ = pageID
		return nil

	default:
		return fmt.Errorf("unknown action %q", c.Type)
	}
}

// textToDoc wraps plain text (with newlines) into a minimal TipTap document.
func textToDoc(text string) []byte {
	lines := strings.Split(text, "\n")
	paras := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		p := map[string]any{"type": "paragraph"}
		if line != "" {
			p["content"] = []map[string]any{{"type": "text", "text": line}}
		}
		paras = append(paras, p)
	}
	doc, _ := json.Marshal(map[string]any{"type": "doc", "content": paras})
	return doc
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func (e *Engine) smtp(ctx context.Context) mailer.Config {
	cfg := mailer.Config{
		Addr: e.st.SettingStr(ctx, "smtp_addr", e.cfg.SMTPAddr),
		From: e.st.SettingStr(ctx, "smtp_from", e.cfg.SMTPFrom),
		Username: e.cfg.SMTPUsername, Password: e.cfg.SMTPPassword,
	}
	if u := e.st.SettingStr(ctx, "smtp_username", ""); u != "" {
		cfg.Username = u
		cfg.Password = e.st.SettingStr(ctx, "smtp_password", "")
	}
	return cfg
}

// notifyFailure honors the rule's notify-on-error policy.
func (e *Engine) notifyFailure(ctx context.Context, rule store.AutomationRule, detail string, autoDisabled bool) {
	if rule.Owner == nil || rule.NotifyOnError == "never" {
		return
	}
	// "once": only when the flow just got auto-disabled (starts failing hard).
	if rule.NotifyOnError == "once" && !autoDisabled {
		return
	}
	smtp := e.smtp(ctx)
	if !smtp.Enabled() {
		return
	}
	subject := fmt.Sprintf("[TaskHat] Automation flow %q failed", rule.Name)
	body := fmt.Sprintf("Your automation flow %q failed: %s\r\n", rule.Name, detail)
	if autoDisabled {
		subject = fmt.Sprintf("[TaskHat] Automation flow %q was disabled", rule.Name)
		body = fmt.Sprintf("Your automation flow %q failed %d times in a row and has been disabled.\r\nLast error: %s\r\n",
			rule.Name, disableAfter, detail)
	}
	if err := mailer.Send(smtp, rule.Owner.Email, subject, body); err != nil {
		e.log.Error("notify flow owner", "rule", rule.Name, "error", err)
	}
}
