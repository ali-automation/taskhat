package jiraimport

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

// Client talks to Jira Cloud's REST APIs with basic auth (email + API token).
type Client struct {
	BaseURL string
	Email   string
	Token   string
	HTTP    *http.Client
}

func NewClient(baseURL, email, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Email:   email,
		Token:   token,
		HTTP:    &http.Client{Timeout: 60 * time.Second},
	}
}

// get fetches a Jira endpoint with 429 Retry-After handling.
func (c *Client) get(ctx context.Context, path string, out any) error {
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
		if err != nil {
			return err
		}
		req.SetBasicAuth(c.Email, c.Token)
		req.Header.Set("Accept", "application/json")
		resp, err := c.HTTP.Do(req)
		if err != nil {
			return fmt.Errorf("jira request %s: %w", path, err)
		}
		if resp.StatusCode == http.StatusTooManyRequests && attempt < 5 {
			wait := 5 * time.Second
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if secs, err := strconv.Atoi(ra); err == nil {
					wait = time.Duration(secs) * time.Second
				}
			}
			resp.Body.Close()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
				continue
			}
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
			return fmt.Errorf("jira %s: HTTP %d: %s", path, resp.StatusCode, string(body))
		}
		return json.NewDecoder(resp.Body).Decode(out)
	}
}

// Download streams an attachment's binary content.
func (c *Client) Download(ctx context.Context, contentURL string) (io.ReadCloser, int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, contentURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.SetBasicAuth(c.Email, c.Token)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("download: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, 0, fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}
	return resp.Body, resp.ContentLength, nil
}

// ---- wire types (subset of Jira's schema) ----

type jiraUser struct {
	AccountID    string `json:"accountId"`
	EmailAddress string `json:"emailAddress"`
	DisplayName  string `json:"displayName"`
}

type jiraIssue struct {
	ID     string `json:"id"`
	Key    string `json:"key"`
	Fields struct {
		Summary     string          `json:"summary"`
		Description json.RawMessage `json:"description"`
		IssueType   struct {
			Name string `json:"name"`
		} `json:"issuetype"`
		Status struct {
			Name           string `json:"name"`
			StatusCategory struct {
				Key string `json:"key"`
			} `json:"statusCategory"`
		} `json:"status"`
		Priority *struct {
			Name string `json:"name"`
		} `json:"priority"`
		Assignee *jiraUser `json:"assignee"`
		Reporter *jiraUser `json:"reporter"`
		Labels   []string  `json:"labels"`
		Parent   *struct {
			Key string `json:"key"`
		} `json:"parent"`
		Created        string   `json:"created"`
		Updated        string   `json:"updated"`
		ResolutionDate *string  `json:"resolutiondate"`
		DueDate        *string  `json:"duedate"`
		StoryPoints    *float64 `json:"customfield_10016"` // company-managed default
		TimeOriginalEstimate *int64 `json:"timeoriginalestimate"`
		TimeEstimate         *int64 `json:"timeestimate"`
		TimeTracking         struct {
			OriginalEstimateSeconds  *int64 `json:"originalEstimateSeconds"`
			RemainingEstimateSeconds *int64 `json:"remainingEstimateSeconds"`
		} `json:"timetracking"`
		Comment        struct {
			Comments []jiraComment `json:"comments"`
			Total    int           `json:"total"`
		} `json:"comment"`
		Attachment []jiraAttachment `json:"attachment"`
		IssueLinks []struct {
			Type struct {
				Name string `json:"name"`
			} `json:"type"`
			OutwardIssue *struct {
				Key string `json:"key"`
			} `json:"outwardIssue"`
		} `json:"issuelinks"`
		FixVersions []struct {
			Name string `json:"name"`
		} `json:"fixVersions"`
		Components []struct {
			Name string `json:"name"`
		} `json:"components"`
		Worklog struct {
			Total    int           `json:"total"`
			Worklogs []jiraWorklog `json:"worklogs"`
		} `json:"worklog"`
	} `json:"fields"`
}

type jiraWorklog struct {
	ID               string          `json:"id"`
	Author           jiraUser        `json:"author"`
	Started          string          `json:"started"`
	TimeSpentSeconds int64           `json:"timeSpentSeconds"`
	Comment          json.RawMessage `json:"comment"`
}

type jiraComment struct {
	ID      string          `json:"id"`
	Author  jiraUser        `json:"author"`
	Body    json.RawMessage `json:"body"`
	Created string          `json:"created"`
}

type jiraAttachment struct {
	ID       string   `json:"id"`
	Filename string   `json:"filename"`
	MimeType string   `json:"mimeType"`
	Size     int64    `json:"size"`
	Content  string   `json:"content"`
	Author   jiraUser `json:"author"`
}

func parseJiraTime(s string) *time.Time {
	if s == "" {
		return nil
	}
	for _, layout := range []string{"2006-01-02T15:04:05.000-0700", time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}
	return nil
}

// FetchAll pulls a whole project through the REST + Agile APIs into Data.
// onProgress is called with a human-readable step description.
// fetchBoardColumns reads the project's board column layout (columns and the
// statuses mapped into each). Best-effort: any failure just means the import
// falls back to one-column-per-status.
func (c *Client) fetchBoardColumns(ctx context.Context, projectKey string) (string, []BoardColumnConfig) {
	var boards struct {
		Values []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"values"`
	}
	if err := c.get(ctx, "/rest/agile/1.0/board?projectKeyOrId="+url.QueryEscape(projectKey), &boards); err != nil || len(boards.Values) == 0 {
		return "", nil
	}
	// Prefer the project's own board ("KEY board") over team boards.
	chosen := boards.Values[0]
	for _, b := range boards.Values {
		if strings.HasPrefix(strings.ToUpper(b.Name), strings.ToUpper(projectKey)) {
			chosen = b
			break
		}
	}
	var conf struct {
		ColumnConfig struct {
			Columns []struct {
				Name     string `json:"name"`
				Statuses []struct {
					ID string `json:"id"`
				} `json:"statuses"`
			} `json:"columns"`
		} `json:"columnConfig"`
	}
	if err := c.get(ctx, fmt.Sprintf("/rest/agile/1.0/board/%d/configuration", chosen.ID), &conf); err != nil {
		return "", nil
	}
	var allStatuses []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := c.get(ctx, "/rest/api/3/status", &allStatuses); err != nil {
		return "", nil
	}
	nameByID := map[string]string{}
	for _, st := range allStatuses {
		nameByID[st.ID] = st.Name
	}
	var cols []BoardColumnConfig
	for _, col := range conf.ColumnConfig.Columns {
		bc := BoardColumnConfig{Name: col.Name}
		for _, st := range col.Statuses {
			if n := nameByID[st.ID]; n != "" {
				bc.StatusNames = append(bc.StatusNames, n)
			}
		}
		cols = append(cols, bc)
	}
	return chosen.Name, cols
}

func (c *Client) FetchAll(ctx context.Context, projectKey string, onProgress func(string)) (*Data, error) {
	data := &Data{Users: map[string]User{}}
	data.BoardName, data.BoardColumns = c.fetchBoardColumns(ctx, projectKey)
	customByJiraID := map[string]map[string]string{} // issue jira id → field values

	var project struct {
		Key  string `json:"key"`
		Name string `json:"name"`
	}
	if err := c.get(ctx, "/rest/api/3/project/"+url.PathEscape(projectKey), &project); err != nil {
		return nil, fmt.Errorf("project lookup: %w", err)
	}
	data.Project = Project{Key: strings.ToUpper(project.Key), Name: project.Name}

	addUser := func(u *jiraUser) string {
		if u == nil || u.AccountID == "" {
			return ""
		}
		if _, ok := data.Users[u.AccountID]; !ok {
			data.Users[u.AccountID] = User{AccountID: u.AccountID, Email: u.EmailAddress, DisplayName: u.DisplayName}
		}
		return u.AccountID
	}

	// Issues, paged. Jira Cloud's current endpoint is /search/jql with
	// token-based pagination (the old /search was removed — CHANGE-2046);
	// Jira Server/DC still uses the legacy startAt-based /search.
	jql := url.QueryEscape(fmt.Sprintf("project = %s ORDER BY created ASC", projectKey))
	fields := "summary,description,issuetype,status,priority,assignee,reporter,labels,parent,created,updated,resolutiondate,duedate,comment,attachment,customfield_10016,issuelinks,fixVersions,components,worklog,timetracking,timeoriginalestimate,timeestimate"
	customDefs, spIDs, startIDs := c.fetchCustomFields(ctx)
	data.CustomFields = customDefs
	for _, def := range customDefs {
		fields += "," + def.JiraID
	}
	for _, id := range spIDs {
		if id != "customfield_10016" {
			fields += "," + id
		}
	}
	fields += strings.Join(append([]string{""}, startIDs...), ",")
	spByJiraID := map[string]float64{}      // issue jira id → story points (site-specific field)
	startByJiraID := map[string]time.Time{} // issue jira id → start date (site-specific field)
	legacy := false
	nextPageToken := ""
	startAt := 0
	fetched := 0
	for {
		var page struct {
			// shared
			Issues []jiraIssue `json:"issues"`
			IsLast *bool       `json:"isLast"`
			// new /search/jql
			NextPageToken string `json:"nextPageToken"`
			// legacy /search
			Total int `json:"total"`
		}
		var path string
		if legacy {
			path = fmt.Sprintf("/rest/api/3/search?jql=%s&startAt=%d&maxResults=50&fields=%s", jql, startAt, fields)
		} else {
			path = fmt.Sprintf("/rest/api/3/search/jql?jql=%s&maxResults=50&fields=%s", jql, fields)
			if nextPageToken != "" {
				path += "&nextPageToken=" + url.QueryEscape(nextPageToken)
			}
		}
		var rawPage struct {
			Issues []struct {
				ID     string                     `json:"id"`
				Fields map[string]json.RawMessage `json:"fields"`
			} `json:"issues"`
		}
		if err := c.get(ctx, path, &rawPage); err == nil {
			for _, ri := range rawPage.Issues {
				vals := map[string]string{}
				for _, def := range data.CustomFields {
					if raw, ok := ri.Fields[def.JiraID]; ok {
						if v := renderCustomValue(def.Type, raw); v != "" {
							vals[def.JiraID] = v
						}
					}
				}
				if len(vals) > 0 {
					customByJiraID[ri.ID] = vals
				}
				for _, id := range spIDs {
					var n *float64
					if raw, ok := ri.Fields[id]; ok && json.Unmarshal(raw, &n) == nil && n != nil {
						spByJiraID[ri.ID] = *n
						break
					}
				}
				for _, id := range startIDs {
					var s string
					if raw, ok := ri.Fields[id]; ok && json.Unmarshal(raw, &s) == nil {
						if t := parseJiraTime(s); t != nil {
							startByJiraID[ri.ID] = *t
							break
						}
					}
				}
			}
		}
		if err := c.get(ctx, path, &page); err != nil {
			// Older Jira (Server/DC) has no /search/jql — fall back once.
			if !legacy && nextPageToken == "" && (strings.Contains(err.Error(), "HTTP 404") || strings.Contains(err.Error(), "HTTP 410")) {
				legacy = true
				continue
			}
			return nil, fmt.Errorf("issue search: %w", err)
		}
		for _, ji := range page.Issues {
			issue := Issue{
				JiraID:         ji.ID,
				Key:            ji.Key,
				Number:         keyNumber(ji.Key),
				Type:           ji.Fields.IssueType.Name,
				Summary:        ji.Fields.Summary,
				Description:    ADFToText(ji.Fields.Description),
				StatusName:     ji.Fields.Status.Name,
				StatusCategory: ji.Fields.Status.StatusCategory.Key,
				Labels:         ji.Fields.Labels,
				StoryPoints:    ji.Fields.StoryPoints,
				CreatedAt:      parseJiraTime(ji.Fields.Created),
				UpdatedAt:      parseJiraTime(ji.Fields.Updated),
				AssigneeAcct:   addUser(ji.Fields.Assignee),
				ReporterAcct:   addUser(ji.Fields.Reporter),
			}
			if issue.StoryPoints == nil {
				if v, ok := spByJiraID[ji.ID]; ok {
					issue.StoryPoints = &v
				}
			}
			if t, ok := startByJiraID[ji.ID]; ok {
				issue.StartDate = &t
			}
			issue.OriginalEstimateSeconds = ji.Fields.TimeTracking.OriginalEstimateSeconds
			if issue.OriginalEstimateSeconds == nil {
				issue.OriginalEstimateSeconds = ji.Fields.TimeOriginalEstimate
			}
			issue.RemainingEstimateSeconds = ji.Fields.TimeTracking.RemainingEstimateSeconds
			if issue.RemainingEstimateSeconds == nil {
				issue.RemainingEstimateSeconds = ji.Fields.TimeEstimate
			}
			if ji.Fields.Priority != nil {
				issue.Priority = ji.Fields.Priority.Name
			}
			if ji.Fields.Parent != nil {
				issue.ParentKey = ji.Fields.Parent.Key
			}
			if ji.Fields.ResolutionDate != nil {
				issue.ResolvedAt = parseJiraTime(*ji.Fields.ResolutionDate)
			}
			if ji.Fields.DueDate != nil {
				issue.DueDate = parseJiraTime(*ji.Fields.DueDate)
			}
			issue.DescriptionADF = ji.Fields.Description
			issue.Custom = customByJiraID[ji.ID]
			for _, l := range ji.Fields.IssueLinks {
				if l.OutwardIssue != nil {
					issue.Links = append(issue.Links, IssueLinkInfo{TypeName: l.Type.Name, OtherKey: l.OutwardIssue.Key})
				}
			}
			for _, v := range ji.Fields.FixVersions {
				issue.FixVersions = append(issue.FixVersions, v.Name)
			}
			for _, comp := range ji.Fields.Components {
				issue.Components = append(issue.Components, comp.Name)
			}
			for _, w := range ji.Fields.Worklog.Worklogs {
				issue.Worklogs = append(issue.Worklogs, WorklogInfo{
					JiraID: w.ID, AuthorAcct: addUser(&w.Author),
					StartedAt: parseJiraTime(w.Started), Seconds: w.TimeSpentSeconds,
					Comment: ADFToText(w.Comment),
				})
			}
			for _, jc := range ji.Fields.Comment.Comments {
				issue.Comments = append(issue.Comments, Comment{
					JiraID:     jc.ID,
					AuthorAcct: addUser(&jc.Author),
					AuthorName: jc.Author.DisplayName,
					Body:       ADFToText(jc.Body),
					BodyADF:    jc.Body,
					CreatedAt:  derefTime(parseJiraTime(jc.Created)),
				})
			}
			for _, ja := range ji.Fields.Attachment {
				issue.Attachments = append(issue.Attachments, Attachment{
					JiraID:     ja.ID,
					Filename:   ja.Filename,
					Mime:       ja.MimeType,
					Size:       ja.Size,
					ContentURL: ja.Content,
					AuthorAcct: addUser(&ja.Author),
				})
			}
			data.Issues = append(data.Issues, issue)
		}
		fetched += len(page.Issues)
		if legacy && page.Total > 0 {
			onProgress(fmt.Sprintf("fetched %d/%d issues", fetched, page.Total))
		} else {
			onProgress(fmt.Sprintf("fetched %d issues", fetched))
		}
		if len(page.Issues) == 0 {
			break
		}
		if legacy {
			startAt += len(page.Issues)
			if startAt >= page.Total {
				break
			}
		} else {
			if page.NextPageToken == "" || (page.IsLast != nil && *page.IsLast) {
				break
			}
			nextPageToken = page.NextPageToken
		}
	}

	// Sprints via the Agile API (best effort — kanban projects have none).
	var boards struct {
		Values []struct {
			ID int `json:"id"`
		} `json:"values"`
	}
	if err := c.get(ctx, "/rest/agile/1.0/board?projectKeyOrId="+url.QueryEscape(projectKey), &boards); err == nil {
		for _, b := range boards.Values {
			var sprints struct {
				Values []struct {
					ID           int     `json:"id"`
					Name         string  `json:"name"`
					State        string  `json:"state"`
					StartDate    *string `json:"startDate"`
					EndDate      *string `json:"endDate"`
					CompleteDate *string `json:"completeDate"`
				} `json:"values"`
			}
			if err := c.get(ctx, fmt.Sprintf("/rest/agile/1.0/board/%d/sprint?state=active,closed,future", b.ID), &sprints); err != nil {
				continue
			}
			for _, sp := range sprints.Values {
				sprint := Sprint{Name: sp.Name, State: mapSprintState(sp.State)}
				if sp.StartDate != nil {
					sprint.StartAt = parseJiraTime(*sp.StartDate)
				}
				if sp.EndDate != nil {
					sprint.EndAt = parseJiraTime(*sp.EndDate)
				}
				if sp.CompleteDate != nil {
					sprint.CompletedAt = parseJiraTime(*sp.CompleteDate)
				}
				var sprintIssues struct {
					Issues []struct {
						Key string `json:"key"`
					} `json:"issues"`
				}
				if err := c.get(ctx, fmt.Sprintf("/rest/agile/1.0/sprint/%d/issue?fields=key&maxResults=500", sp.ID), &sprintIssues); err == nil {
					for _, si := range sprintIssues.Issues {
						sprint.IssueKeys = append(sprint.IssueKeys, si.Key)
					}
				}
				data.Sprints = append(data.Sprints, sprint)
			}
			onProgress(fmt.Sprintf("fetched %d sprints", len(data.Sprints)))
		}
	}

	c.FetchIssueExtras(ctx, data, onProgress)
	data.AvatarBytes, data.AvatarMime = c.FetchProjectAvatar(ctx, projectKey)
	return data, nil
}

func mapSprintState(s string) string {
	switch strings.ToLower(s) {
	case "active":
		return "active"
	case "closed":
		return "closed"
	default:
		return "future"
	}
}

func keyNumber(key string) int64 {
	idx := strings.LastIndexByte(key, '-')
	if idx < 0 {
		return 0
	}
	n, _ := strconv.ParseInt(key[idx+1:], 10, 64)
	return n
}

func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Now().UTC()
	}
	return *t
}

// fetchCustomFields discovers Jira custom fields whose types map onto
// TaskHat's (text/number/date/select). Best-effort; capped to keep the
// search field list sane. Story points are handled separately.
func (c *Client) fetchCustomFields(ctx context.Context) ([]CustomFieldDef, []string, []string) {
	spIDs := []string{"customfield_10016"} // company-managed default, always tried
	var startIDs []string                  // site-specific "Start date" fields
	var fields []struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Custom bool   `json:"custom"`
		Schema struct {
			Type string `json:"type"`
		} `json:"schema"`
	}
	if err := c.get(ctx, "/rest/api/3/field", &fields); err != nil {
		return nil, spIDs, nil
	}
	// Pass 1 — native-field discovery over the ENTIRE registry (the defs cap
	// below must never cut this short). Story points and start date live
	// under site-specific ids ("Story Points", "Story point estimate"); they
	// map onto native columns, never onto custom fields.
	for _, f := range fields {
		if !f.Custom || f.Name == "" {
			continue
		}
		if IsStoryPointField(f.Name) && f.ID != "customfield_10016" {
			spIDs = append(spIDs, f.ID)
		} else if IsStartDateField(f.Name) {
			startIDs = append(startIDs, f.ID)
		}
	}
	// Pass 2 — custom-field defs, capped.
	var defs []CustomFieldDef
	for _, f := range fields {
		if !f.Custom || f.ID == "customfield_10016" || f.Name == "" ||
			IsStoryPointField(f.Name) || IsStartDateField(f.Name) {
			continue
		}
		var t string
		switch f.Schema.Type {
		case "string":
			t = "text"
		case "number":
			t = "number"
		case "date", "datetime":
			t = "date"
		case "option":
			t = "select"
		default:
			continue
		}
		defs = append(defs, CustomFieldDef{JiraID: f.ID, Name: f.Name, Type: t})
		if len(defs) >= 30 {
			break
		}
	}
	return defs, spIDs, startIDs
}

// IsStartDateField reports whether a Jira field name is the site-specific
// start-date field (TaskHat has a native start_date column).
func IsStartDateField(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), "start date")
}

// IsStoryPointField reports whether a Jira field name is one of the
// site-specific story-points estimate fields.
func IsStoryPointField(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "story points", "story point estimate", "story points estimate":
		return true
	}
	return false
}

// renderCustomValue turns a raw Jira custom value into TaskHat's stored form.
func renderCustomValue(taskhatType string, raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	switch taskhatType {
	case "text":
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return strings.TrimSpace(s)
		}
		// Some "string" fields are ADF (e.g. multiline text).
		return strings.TrimSpace(ADFToText(raw))
	case "number":
		var n float64
		if json.Unmarshal(raw, &n) == nil {
			return strconv.FormatFloat(n, 'f', -1, 64)
		}
	case "date":
		var s string
		if json.Unmarshal(raw, &s) == nil && len(s) >= 10 {
			return s[:10]
		}
	case "select":
		var v struct {
			Value string `json:"value"`
		}
		if json.Unmarshal(raw, &v) == nil {
			return v.Value
		}
	}
	return ""
}

// FetchIssueExtras pulls per-issue data that has no bulk endpoint: the
// changelog (history) and watchers. One pair of calls per issue.
func (c *Client) FetchIssueExtras(ctx context.Context, data *Data, onProgress func(string)) {
	addUser := func(u *jiraUser) string {
		if u == nil || u.AccountID == "" {
			return ""
		}
		if _, ok := data.Users[u.AccountID]; !ok {
			data.Users[u.AccountID] = User{AccountID: u.AccountID, Email: u.EmailAddress, DisplayName: u.DisplayName}
		}
		return u.AccountID
	}
	for i := range data.Issues {
		key := data.Issues[i].Key
		// Changelog (paged).
		startAt := 0
		for {
			var page struct {
				Values []struct {
					Author  *jiraUser `json:"author"`
					Created string    `json:"created"`
					Items   []struct {
						Field      string `json:"field"`
						FromString string `json:"fromString"`
						ToString   string `json:"toString"`
					} `json:"items"`
				} `json:"values"`
				IsLast bool `json:"isLast"`
			}
			if err := c.get(ctx, fmt.Sprintf("/rest/api/3/issue/%s/changelog?startAt=%d&maxResults=100", url.PathEscape(key), startAt), &page); err != nil {
				break
			}
			for _, h := range page.Values {
				for _, item := range h.Items {
					data.Issues[i].History = append(data.Issues[i].History, HistoryInfo{
						AuthorAcct: addUser(h.Author), CreatedAt: parseJiraTime(h.Created),
						Field: strings.ToLower(item.Field), From: item.FromString, To: item.ToString,
					})
				}
			}
			startAt += len(page.Values)
			if page.IsLast || len(page.Values) == 0 {
				break
			}
		}
		// Watchers.
		var w struct {
			Watchers []jiraUser `json:"watchers"`
		}
		if err := c.get(ctx, "/rest/api/3/issue/"+url.PathEscape(key)+"/watchers", &w); err == nil {
			for j := range w.Watchers {
				if acct := addUser(&w.Watchers[j]); acct != "" {
					data.Issues[i].Watchers = append(data.Issues[i].Watchers, acct)
				}
			}
		}
		if i%20 == 19 && onProgress != nil {
			onProgress(fmt.Sprintf("history/watchers %d/%d", i+1, len(data.Issues)))
		}
	}
}

// FetchProjectAvatar downloads the project's 48px avatar for the space icon.
func (c *Client) FetchProjectAvatar(ctx context.Context, projectKey string) ([]byte, string) {
	var p struct {
		AvatarUrls map[string]string `json:"avatarUrls"`
	}
	if err := c.get(ctx, "/rest/api/3/project/"+url.PathEscape(projectKey), &p); err != nil {
		return nil, ""
	}
	u := p.AvatarUrls["48x48"]
	if u == "" {
		return nil, ""
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, ""
	}
	req.SetBasicAuth(c.Email, c.Token)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, ""
	}
	bin, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || len(bin) == 0 {
		return nil, ""
	}
	return bin, resp.Header.Get("Content-Type")
}
