package jiraimport

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// ParseCSV reads a Jira "Export issues (CSV, all fields)" file. Jira CSVs
// repeat columns for multi-value fields (Labels, Comment, Sprint, …).
func ParseCSV(r io.Reader) (*Data, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("csv header: %w", err)
	}
	// column name (lowered) → indexes (repeated columns collect all)
	cols := map[string][]int{}
	for i, h := range header {
		key := strings.ToLower(strings.TrimSpace(h))
		cols[key] = append(cols[key], i)
	}
	col := func(row []string, name string) string {
		for _, i := range cols[name] {
			if i < len(row) && strings.TrimSpace(row[i]) != "" {
				return strings.TrimSpace(row[i])
			}
		}
		return ""
	}
	colAll := func(row []string, name string) []string {
		var out []string
		for _, i := range cols[name] {
			if i < len(row) && strings.TrimSpace(row[i]) != "" {
				out = append(out, strings.TrimSpace(row[i]))
			}
		}
		return out
	}
	if len(cols["issue key"]) == 0 || len(cols["summary"]) == 0 {
		return nil, fmt.Errorf("not a Jira CSV export: missing 'Issue key' or 'Summary' column")
	}

	data := &Data{Users: map[string]User{}}
	sprintIssues := map[string][]string{}

	addUser := func(name string) string {
		if name == "" {
			return ""
		}
		// CSV user cells hold display name, username, or email; key by value.
		key := strings.ToLower(name)
		if _, ok := data.Users[key]; !ok {
			u := User{DisplayName: name}
			if strings.Contains(name, "@") {
				u.Email = strings.ToLower(name)
			}
			data.Users[key] = u
		}
		return key
	}

	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("csv row: %w", err)
		}
		key := col(row, "issue key")
		if key == "" {
			continue
		}
		if data.Project.Key == "" {
			if idx := strings.LastIndexByte(key, '-'); idx > 0 {
				data.Project.Key = strings.ToUpper(key[:idx])
			}
		}
		issue := Issue{
			JiraID:       col(row, "issue id"),
			Key:          strings.ToUpper(key),
			Number:       keyNumber(key),
			Type:         col(row, "issue type"),
			Summary:      col(row, "summary"),
			Description:  col(row, "description"),
			StatusName:   col(row, "status"),
			Priority:     col(row, "priority"),
			Labels:       splitLabels(colAll(row, "labels")),
			AssigneeAcct: addUser(col(row, "assignee")),
			ReporterAcct: addUser(col(row, "reporter")),
			CreatedAt:    parseCSVTime(col(row, "created")),
			DueDate:      parseCSVTime(col(row, "due date")),
			ResolvedAt:   parseCSVTime(col(row, "resolved")),
		}
		if issue.JiraID == "" {
			issue.JiraID = "csv-" + issue.Key
		}
		if pts := col(row, "custom field (story points)"); pts != "" {
			if v, err := strconv.ParseFloat(pts, 64); err == nil {
				issue.StoryPoints = &v
			}
		} else if pts := col(row, "story points"); pts != "" {
			if v, err := strconv.ParseFloat(pts, 64); err == nil {
				issue.StoryPoints = &v
			}
		}
		if p := col(row, "parent"); p != "" {
			issue.ParentKey = strings.ToUpper(p)
		} else if p := col(row, "custom field (epic link)"); p != "" {
			issue.ParentKey = strings.ToUpper(p)
		}
		// Jira encodes comments as "date; author; body".
		for i, c := range colAll(row, "comment") {
			parts := strings.SplitN(c, ";", 3)
			comment := Comment{JiraID: fmt.Sprintf("csv-%s-c%d", issue.Key, i), Body: c, CreatedAt: time.Now().UTC()}
			if len(parts) == 3 {
				if t := parseCSVTime(strings.TrimSpace(parts[0])); t != nil {
					comment.CreatedAt = *t
				}
				comment.AuthorAcct = addUser(strings.TrimSpace(parts[1]))
				comment.Body = strings.TrimSpace(parts[2])
			}
			issue.Comments = append(issue.Comments, comment)
		}
		for _, sp := range colAll(row, "sprint") {
			sprintIssues[sp] = append(sprintIssues[sp], issue.Key)
		}
		data.Issues = append(data.Issues, issue)
	}

	for name, keys := range sprintIssues {
		data.Sprints = append(data.Sprints, Sprint{Name: name, State: "closed", IssueKeys: keys})
	}
	if data.Project.Key != "" {
		data.Project.Name = data.Project.Key
	}
	return data, nil
}

// splitLabels handles both repeated Label columns and space-separated cells.
func splitLabels(cells []string) []string {
	var out []string
	for _, c := range cells {
		out = append(out, strings.Fields(c)...)
	}
	return out
}

var csvTimeLayouts = []string{
	"02/Jan/06 3:04 PM",
	"02/Jan/2006 3:04 PM",
	"2006-01-02 15:04",
	"2006-01-02T15:04:05.000-0700",
	time.RFC3339,
	"2006-01-02",
	"02/01/2006 15:04",
	"1/2/2006 15:04",
}

func parseCSVTime(s string) *time.Time {
	if s == "" {
		return nil
	}
	for _, layout := range csvTimeLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}
	return nil
}
