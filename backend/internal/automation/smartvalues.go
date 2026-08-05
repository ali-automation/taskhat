package automation

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

// smartValues builds the {{…}} substitution map for the current context item.
func (e *Engine) smartValues(ctx context.Context, issue store.Issue, ev events.Event, rs *runState) map[string]string {
	sv := map[string]string{
		"now":               time.Now().Format("2006-01-02 15:04"),
		"actor.displayName": "TaskHat Automation",
	}
	if actor, err := e.st.GetUserByID(ctx, ev.ActorID); err == nil {
		sv["actor.displayName"] = actor.DisplayName
		sv["actor.email"] = actor.Email
	}
	if issue.ID != "" {
		assignee := ""
		assigneeEmail := ""
		if issue.Assignee != nil {
			assignee = issue.Assignee.DisplayName
			assigneeEmail = issue.Assignee.Email
		}
		sv["issue.key"] = issue.Key
		sv["issue.summary"] = issue.Summary
		sv["issue.description"] = issue.Description
		sv["issue.type"] = issue.Type
		sv["issue.priority"] = issue.Priority
		sv["issue.status.name"] = issue.Status.Name
		sv["issue.assignee.displayName"] = assignee
		sv["issue.assignee.email"] = assigneeEmail
		sv["issue.reporter.displayName"] = issue.Reporter.DisplayName
		sv["issue.reporter.email"] = issue.Reporter.Email
		sv["issue.projectKey"] = issue.ProjectKey
		sv["issue.url"] = e.cfg.BaseURL + "/browse/" + issue.Key
		sv["issue.labels"] = strings.Join(issue.Labels, ", ")
	}
	if strings.HasPrefix(ev.Type, "comment.") {
		var v struct {
			Comment store.Comment `json:"comment"`
		}
		if json.Unmarshal(ev.Payload, &v) == nil {
			sv["trigger.comment.body"] = v.Comment.Body
			sv["trigger.comment.author"] = v.Comment.Author.DisplayName
		}
	}
	if strings.HasPrefix(ev.Type, "issue.link") {
		var v struct {
			LinkType string `json:"linkType"`
			OtherKey string `json:"otherKey"`
		}
		if json.Unmarshal(ev.Payload, &v) == nil {
			sv["link.type"] = v.LinkType
			sv["link.otherKey"] = v.OtherKey
		}
	}
	if strings.HasPrefix(ev.Type, "sprint.") {
		var v struct {
			Name       string `json:"name"`
			Goal       string `json:"goal"`
			ProjectKey string `json:"projectKey"`
		}
		if json.Unmarshal(ev.Payload, &v) == nil {
			sv["sprint.name"] = v.Name
			sv["sprint.goal"] = v.Goal
			sv["sprint.projectKey"] = v.ProjectKey
		}
	}
	if rs.created != nil {
		sv["createdIssue.key"] = rs.created.Key
		sv["createdIssue.url"] = e.cfg.BaseURL + "/browse/" + rs.created.Key
	}
	return sv
}

var smartValueRe = regexp.MustCompile(`\{\{\s*([a-zA-Z.]+?)(?:\.plusDays\((\d+)\))?\s*\}\}`)

// render substitutes {{smart.values}} (incl. {{now.plusDays(n)}}) in a template.
func render(template string, sv map[string]string) string {
	return smartValueRe.ReplaceAllStringFunc(template, func(m string) string {
		parts := smartValueRe.FindStringSubmatch(m)
		name, plus := parts[1], parts[2]
		if name == "now" && plus != "" {
			days, _ := strconv.Atoi(plus)
			return time.Now().AddDate(0, 0, days).Format("2006-01-02")
		}
		if v, ok := sv[name]; ok {
			return v
		}
		return m // unknown smart value: leave visible, like Jira
	})
}

// postSigned sends an automation web request, HMAC-signed when a secret is set.
func (e *Engine) postSigned(ctx context.Context, url, secret, eventType string, body []byte) (int, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TaskHat-Automation/1.0")
	req.Header.Set("X-TaskHat-Event", eventType)
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		req.Header.Set("X-TaskHat-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return resp.StatusCode, http.StatusText(resp.StatusCode)
	}
	return resp.StatusCode, ""
}
