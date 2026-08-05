// Package jiraimport pulls projects out of Jira (Cloud REST API or CSV
// export) into a normalized model, then loads it into TaskHat idempotently.
package jiraimport

import "time"

type Project struct {
	Key  string
	Name string
}

type User struct {
	AccountID   string // empty for CSV imports
	Email       string // may be empty (privacy settings)
	DisplayName string
}

type Comment struct {
	JiraID     string
	AuthorAcct string // account id or email
	AuthorName string
	Body       string
	BodyADF    []byte
	CreatedAt  time.Time
}

type Attachment struct {
	JiraID     string
	Filename   string
	Mime       string
	Size       int64
	ContentURL string // download URL (API import only)
	AuthorAcct string
}

type Sprint struct {
	Name        string
	State       string // future | active | closed
	StartAt     *time.Time
	EndAt       *time.Time
	CompletedAt *time.Time
	IssueKeys   []string
}

type Issue struct {
	JiraID         string
	Key            string // e.g. DEMO-7
	Number         int64
	Type           string // raw Jira type name
	Summary        string
	Description    string // plain text (ADF flattened)
	StatusName     string
	StatusCategory string // new | indeterminate | done (Jira category keys)
	Priority       string // raw Jira priority name
	AssigneeAcct   string
	ReporterAcct   string
	Labels         []string
	StoryPoints    *float64
	OriginalEstimateSeconds  *int64
	RemainingEstimateSeconds *int64
	StartDate      *time.Time
	DueDate        *time.Time
	CreatedAt      *time.Time
	UpdatedAt      *time.Time
	ResolvedAt     *time.Time
	ParentKey      string
	DescriptionADF []byte // raw ADF for rich-text conversion
	Comments       []Comment
	Attachments    []Attachment
	Links          []IssueLinkInfo
	FixVersions    []string
	Components     []string
	Worklogs       []WorklogInfo
	History        []HistoryInfo
	Watchers       []string // account ids
	Custom         map[string]string // custom field jira id → rendered value
}

type IssueLinkInfo struct {
	TypeName string // Jira link type name, e.g. "Blocks"
	OtherKey string // outward issue key
}

type WorklogInfo struct {
	JiraID     string
	AuthorAcct string
	StartedAt  *time.Time
	Seconds    int64
	Comment    string
}

type HistoryInfo struct {
	AuthorAcct string
	CreatedAt  *time.Time
	Field      string
	From       string
	To         string
}

// CustomFieldDef is a Jira custom field the import can carry.
type CustomFieldDef struct {
	JiraID string
	Name   string
	Type   string // taskhat type: text | number | date | select
}

// Data is everything a source produced, ready for loading.
type Data struct {
	Project Project
	Users   map[string]User // by AccountID (or email for CSV)
	Issues  []Issue         // in original (rank-ish) order
	Sprints []Sprint
	// Jira board layout (columns → status names); empty for CSV imports.
	BoardName    string
	BoardColumns []BoardColumnConfig
	CustomFields []CustomFieldDef
	AvatarBytes  []byte // project avatar binary (small PNG)
	AvatarMime   string
}

type BoardColumnConfig struct {
	Name        string
	StatusNames []string
}

// MapType applies the default type mapping (custom types become tasks).
// MapTypeStrict maps well-known Jira type names onto the built-in work
// types; ok=false means the type is custom and should be created as one.
func MapTypeStrict(jiraType string) (string, bool) {
	switch normalize(jiraType) {
	case "epic":
		return "epic", true
	case "story":
		return "story", true
	case "bug":
		return "bug", true
	case "sub-task", "subtask":
		return "subtask", true
	case "task", "":
		return "task", true
	}
	return "", false
}

func MapType(jiraType string) string {
	if key, ok := MapTypeStrict(jiraType); ok {
		return key
	}
	return "task"
}

// MapPriority applies the default priority mapping (custom → medium).
func MapPriority(jiraPriority string) string {
	switch normalize(jiraPriority) {
	case "highest", "blocker":
		return "highest"
	case "high", "critical", "major":
		return "high"
	case "low", "minor":
		return "low"
	case "lowest", "trivial":
		return "lowest"
	default:
		return "medium"
	}
}

// MapStatusCategory maps Jira's three status categories onto the default
// workflow's statuses by category.
func MapStatusCategory(category, statusName string) string {
	switch normalize(category) {
	case "done":
		return "done"
	case "indeterminate", "in progress":
		return "in_progress"
	case "new", "to do", "todo", "":
		// CSV has no category; fall back on well-known status names.
		switch normalize(statusName) {
		case "in progress", "in review", "in development":
			return "in_progress"
		case "done", "closed", "resolved":
			return "done"
		default:
			return "todo"
		}
	default:
		return "todo"
	}
}

func normalize(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			r += 'a' - 'A'
		}
		out = append(out, r)
	}
	return string(out)
}
