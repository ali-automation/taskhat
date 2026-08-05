package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

var priorities = map[string]bool{"highest": true, "high": true, "medium": true, "low": true, "lowest": true}

// parseIssueKey splits "TH-12" into ("TH", 12).
func parseIssueKey(key string) (string, int64, bool) {
	idx := strings.LastIndexByte(key, '-')
	if idx <= 0 {
		return "", 0, false
	}
	number, err := strconv.ParseInt(key[idx+1:], 10, 64)
	if err != nil || number <= 0 {
		return "", 0, false
	}
	return strings.ToUpper(key[:idx]), number, true
}

// requireIssue loads the issue by key and checks project membership.
func (s *Server) requireIssue(w http.ResponseWriter, r *http.Request) (store.Issue, string, bool) {
	projectKey, number, ok := parseIssueKey(chi.URLParam(r, "key"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid issue key")
		return store.Issue{}, "", false
	}
	issue, err := s.store.GetIssueByKey(r.Context(), projectKey, number)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "issue not found")
		return store.Issue{}, "", false
	}
	if err != nil {
		s.internalError(w, "get issue", err)
		return store.Issue{}, "", false
	}
	role, err := s.store.MemberRole(r.Context(), issue.ProjectID, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusForbidden, "you are not a member of this project")
		return store.Issue{}, "", false
	}
	if err != nil {
		s.internalError(w, "member role", err)
		return store.Issue{}, "", false
	}
	return issue, role, true
}

func writeReadOnly(w http.ResponseWriter) {
	writeError(w, http.StatusForbidden, "viewers cannot modify issues")
}

// issueFields mirrors Jira's { fields: { ... } } create/edit payload.
type issueFields struct {
	Project *struct {
		Key string `json:"key"`
	} `json:"project"`
	IssueType *struct {
		Name string `json:"name"`
	} `json:"issuetype"`
	Summary        *string         `json:"summary"`
	Description    *string         `json:"description"`
	DescriptionDoc json.RawMessage `json:"descriptionDoc"` // TipTap JSON
	Priority    *struct {
		Name string `json:"name"`
	} `json:"priority"`
	Assignee *struct {
		ID *string `json:"id"`
	} `json:"assignee"`
	Labels      *[]string       `json:"labels"`
	DueDate     *string         `json:"duedate"`     // YYYY-MM-DD, empty string clears
	StartDate   *string         `json:"startDate"`   // YYYY-MM-DD, empty string clears
	FixVersions *[]struct {
		ID string `json:"id"`
	} `json:"fixVersions"` // replaces the set
	OriginalEstimate  *string `json:"originalEstimate"`  // "2d 4h", "" clears
	RemainingEstimate *string `json:"remainingEstimate"` // "1d", "" clears
	Sprint      json.RawMessage `json:"sprint"`      // {"id":"..."} or null (backlog)
	Parent      json.RawMessage `json:"parent"`      // {"key":"TH-1"} or null (remove)
	StoryPoints json.RawMessage `json:"storyPoints"` // number or null
	Custom      map[string]any  `json:"custom"`      // { fieldId: value }, null value clears
}

// parseSprintField resolves the sprint wrapper to (set, id-or-nil).
func parseSprintField(raw json.RawMessage) (bool, *string, error) {
	if len(raw) == 0 {
		return false, nil, nil
	}
	if string(raw) == "null" {
		return true, nil, nil
	}
	var v struct {
		ID *string `json:"id"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, nil, err
	}
	if v.ID == nil || *v.ID == "" {
		return true, nil, nil
	}
	return true, v.ID, nil
}

// parseParentField resolves the parent wrapper to (set, key-or-nil).
func parseParentField(raw json.RawMessage) (bool, *string, error) {
	if len(raw) == 0 {
		return false, nil, nil
	}
	if string(raw) == "null" {
		return true, nil, nil
	}
	var v struct {
		Key *string `json:"key"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, nil, err
	}
	if v.Key == nil || *v.Key == "" {
		return true, nil, nil
	}
	return true, v.Key, nil
}

func parsePointsField(raw json.RawMessage) (bool, *float64, error) {
	if len(raw) == 0 {
		return false, nil, nil
	}
	if string(raw) == "null" {
		return true, nil, nil
	}
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, nil, err
	}
	if v < 0 {
		return false, nil, errors.New("story points must be >= 0")
	}
	return true, &v, nil
}

// resolveParentID maps a parent key to the issue id, enforcing same-project.
func (s *Server) resolveParentID(r *http.Request, projectKey string, parentKey *string) (*string, error) {
	if parentKey == nil {
		return nil, nil
	}
	pk, num, ok := parseIssueKey(*parentKey)
	if !ok || pk != projectKey {
		return nil, errors.New("parent must be an issue key in the same project")
	}
	parent, err := s.store.GetIssueByKey(r.Context(), pk, num)
	if err != nil {
		return nil, errors.New("parent issue not found")
	}
	if parent.Type == "subtask" {
		return nil, errors.New("a sub-task cannot be a parent")
	}
	return &parent.ID, nil
}

type issueRequest struct {
	Fields issueFields `json:"fields"`
}

func (s *Server) handleCreateIssue(w http.ResponseWriter, r *http.Request) {
	var req issueRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	f := req.Fields
	fields := map[string]string{}
	if f.Project == nil || f.Project.Key == "" {
		fields["project"] = "project key required"
	}
	issueType := "task"
	if f.IssueType != nil {
		issueType = strings.ToLower(f.IssueType.Name)
	}
	if ok, err := s.store.WorkTypeEnabled(r.Context(), issueType); err != nil {
		s.internalError(w, "work type lookup", err)
		return
	} else if !ok {
		fields["issuetype"] = "not an enabled work type"
	}
	summary := ""
	if f.Summary != nil {
		summary = strings.TrimSpace(*f.Summary)
	}
	if summary == "" {
		fields["summary"] = "summary required"
	}
	priority := "medium"
	if f.Priority != nil {
		priority = strings.ToLower(f.Priority.Name)
	}
	if !priorities[priority] {
		fields["priority"] = "must be one of highest, high, medium, low, lowest"
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}

	project, _, ok := s.requireProject(w, r, f.Project.Key)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, project.ID, "create", nil) {
		return
	}

	description := ""
	if f.Description != nil {
		description = *f.Description
	}
	if len(f.DescriptionDoc) > 0 && string(f.DescriptionDoc) != "null" {
		description = docText(f.DescriptionDoc)
	} else {
		f.DescriptionDoc = nil
	}
	var assigneeID *string
	if f.Assignee != nil && f.Assignee.ID != nil && *f.Assignee.ID != "" {
		assigneeID = f.Assignee.ID
	} else if f.Assignee == nil && project.DefaultAssigneeID != nil {
		// Space setting: assign new work items to the default assignee when
		// the creator didn't touch the assignee field at all.
		assigneeID = project.DefaultAssigneeID
	}
	labels := []string{}
	if f.Labels != nil {
		labels = normalizeLabels(*f.Labels)
	}
	_, sprintID, err := parseSprintField(f.Sprint)
	if err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"sprint": err.Error()})
		return
	}
	_, parentKey, err := parseParentField(f.Parent)
	if err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"parent": err.Error()})
		return
	}
	parentID, err := s.resolveParentID(r, project.Key, parentKey)
	if err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"parent": err.Error()})
		return
	}
	_, points, err := parsePointsField(f.StoryPoints)
	if err != nil {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"storyPoints": err.Error()})
		return
	}

	issue, err := s.store.CreateIssue(r.Context(), store.NewIssue{
		ProjectID:      project.ID,
		Type:           issueType,
		Summary:        summary,
		Description:    description,
		DescriptionDoc: f.DescriptionDoc,
		Priority:    priority,
		AssigneeID:  assigneeID,
		ReporterID:  userIDFrom(r.Context()),
		Labels:      labels,
		ParentID:    parentID,
		SprintID:    sprintID,
		StoryPoints: points,
	})
	if err != nil {
		s.internalError(w, "create issue", err)
		return
	}
	if len(f.Custom) > 0 {
		if _, err := s.store.SetIssueFieldValues(r.Context(), issue.ID, project.ID, f.Custom); err != nil {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"custom": err.Error()})
			return
		}
		if issue, err = s.store.GetIssueByID(r.Context(), issue.ID); err != nil {
			s.internalError(w, "reload issue", err)
			return
		}
	}
	s.publish(r, "issue.created", issue)
	writeJSON(w, http.StatusCreated, issue)
}

func (s *Server) handleGetIssue(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, issue)
}

func (s *Server) handleUpdateIssue(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "edit", &issue) {
		return
	}
	var req issueRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	f := req.Fields

	upd := store.IssueUpdate{}
	fields := map[string]string{}
	if f.Summary != nil {
		trimmed := strings.TrimSpace(*f.Summary)
		if trimmed == "" {
			fields["summary"] = "summary cannot be empty"
		}
		upd.Summary = &trimmed
	}
	upd.Description = f.Description
	if len(f.DescriptionDoc) > 0 && string(f.DescriptionDoc) != "null" {
		text := docText(f.DescriptionDoc)
		upd.Description = &text
		upd.DescriptionDoc = f.DescriptionDoc
	}
	if f.Priority != nil {
		p := strings.ToLower(f.Priority.Name)
		if !priorities[p] {
			fields["priority"] = "must be one of highest, high, medium, low, lowest"
		}
		upd.Priority = &p
	}
	if f.IssueType != nil {
		t := strings.ToLower(f.IssueType.Name)
		if ok, err := s.store.WorkTypeEnabled(r.Context(), t); err != nil {
			s.internalError(w, "work type lookup", err)
			return
		} else if !ok {
			fields["issuetype"] = "not an enabled work type"
		}
		upd.Type = &t
	}
	if f.Assignee != nil {
		if !s.requirePerm(w, r, issue.ProjectID, "assign", &issue) {
			return
		}
		upd.SetAssignee = true
		if f.Assignee.ID != nil && *f.Assignee.ID != "" {
			upd.AssigneeID = f.Assignee.ID
		}
	}
	if f.Labels != nil {
		normalized := normalizeLabels(*f.Labels)
		upd.Labels = &normalized
	}
	if setSprint, sprintID, err := parseSprintField(f.Sprint); err != nil {
		fields["sprint"] = err.Error()
	} else if setSprint {
		upd.SetSprint = true
		upd.SprintID = sprintID
	}
	if setParent, parentKey, err := parseParentField(f.Parent); err != nil {
		fields["parent"] = err.Error()
	} else if setParent {
		upd.SetParent = true
		parentID, err := s.resolveParentID(r, issue.ProjectKey, parentKey)
		if err != nil {
			fields["parent"] = err.Error()
		}
		upd.ParentID = parentID
	}
	if setPoints, points, err := parsePointsField(f.StoryPoints); err != nil {
		fields["storyPoints"] = err.Error()
	} else if setPoints {
		upd.SetPoints = true
		upd.Points = points
	}
	if f.DueDate != nil {
		if *f.DueDate == "" {
			upd.ClearDue = true
		} else {
			due, err := time.Parse("2006-01-02", *f.DueDate)
			if err != nil {
				fields["duedate"] = "must be YYYY-MM-DD"
			} else {
				upd.DueDate = &due
			}
		}
	}
	if f.StartDate != nil {
		if *f.StartDate == "" {
			upd.ClearStart = true
		} else {
			start, err := time.Parse("2006-01-02", *f.StartDate)
			if err != nil {
				fields["startDate"] = "must be YYYY-MM-DD"
			} else {
				upd.StartDate = &start
			}
		}
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return
	}

	updated, err := s.store.UpdateIssue(r.Context(), issue.ID, userIDFrom(r.Context()), upd)
	if err != nil {
		s.internalError(w, "update issue", err)
		return
	}
	changedFields := changedFieldNames(upd)
	if f.OriginalEstimate != nil || f.RemainingEstimate != nil {
		parseEst := func(v *string, name string) (bool, *int64, bool) {
			if v == nil {
				return false, nil, true
			}
			if strings.TrimSpace(*v) == "" {
				return true, nil, true
			}
			sec, err := parseJiraDuration(*v)
			if err != nil {
				writeFieldErrors(w, http.StatusBadRequest, map[string]string{name: err.Error()})
				return false, nil, false
			}
			return true, &sec, true
		}
		setO, oSec, ok1 := parseEst(f.OriginalEstimate, "originalEstimate")
		if !ok1 {
			return
		}
		setR, rSec, ok2 := parseEst(f.RemainingEstimate, "remainingEstimate")
		if !ok2 {
			return
		}
		if err := s.store.SetIssueEstimates(r.Context(), issue.ID, setO, oSec, setR, rSec); err != nil {
			s.internalError(w, "set estimates", err)
			return
		}
		fmtEst := func(p *int64) any {
			if p == nil {
				return nil
			}
			return formatJiraDuration(*p)
		}
		changes := []store.FieldChange{}
		if setO {
			changes = append(changes, store.FieldChange{FieldName: "originalEstimate", Old: fmtEst(issue.OriginalEstimateSeconds), New: fmtEst(oSec)})
			changedFields = append(changedFields, "originalEstimate")
		}
		if setR {
			changes = append(changes, store.FieldChange{FieldName: "remainingEstimate", Old: fmtEst(issue.RemainingEstimateSeconds), New: fmtEst(rSec)})
			changedFields = append(changedFields, "remainingEstimate")
		}
		s.store.RecordFieldChanges(r.Context(), issue.ID, userIDFrom(r.Context()), changes)
		if updated, err = s.store.GetIssueByID(r.Context(), issue.ID); err != nil {
			s.internalError(w, "reload issue", err)
			return
		}
	}
	if f.FixVersions != nil {
		ids := make([]string, 0, len(*f.FixVersions))
		for _, v := range *f.FixVersions {
			if v.ID != "" {
				ids = append(ids, v.ID)
			}
		}
		oldNames, newNames, err := s.store.SetIssueFixVersions(r.Context(), issue.ID, ids)
		if err != nil {
			s.internalError(w, "set fix versions", err)
			return
		}
		if strings.Join(oldNames, ",") != strings.Join(newNames, ",") {
			s.store.RecordFieldChanges(r.Context(), issue.ID, userIDFrom(r.Context()),
				[]store.FieldChange{{FieldName: "fixVersions", Old: strings.Join(oldNames, ", "), New: strings.Join(newNames, ", ")}})
			changedFields = append(changedFields, "fixVersions")
		}
		if updated, err = s.store.GetIssueByID(r.Context(), issue.ID); err != nil {
			s.internalError(w, "reload issue", err)
			return
		}
	}
	if len(f.Custom) > 0 {
		changes, err := s.store.SetIssueFieldValues(r.Context(), issue.ID, issue.ProjectID, f.Custom)
		if err != nil {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"custom": err.Error()})
			return
		}
		s.store.RecordFieldChanges(r.Context(), issue.ID, userIDFrom(r.Context()), changes)
		for _, c := range changes {
			changedFields = append(changedFields, c.FieldName)
		}
		if updated, err = s.store.GetIssueByID(r.Context(), issue.ID); err != nil {
			s.internalError(w, "reload issue", err)
			return
		}
	}
	s.publish(r, "issue.updated", updated)
	if len(changedFields) > 0 {
		s.publish(r, "issue.field_changed", fieldChangedPayload{Issue: updated, ChangedFields: changedFields})
	}
	writeJSON(w, http.StatusOK, updated)
}

// fieldChangedPayload flattens the issue so existing consumers can unmarshal
// it as a plain issue; changedFields drives the automation trigger.
type fieldChangedPayload struct {
	store.Issue
	ChangedFields []string `json:"changedFields"`
}

// changedFieldNames maps the edit payload onto trigger-friendly field names.
func changedFieldNames(upd store.IssueUpdate) []string {
	fields := []string{}
	if upd.Summary != nil {
		fields = append(fields, "summary")
	}
	if upd.Description != nil {
		fields = append(fields, "description")
	}
	if upd.Priority != nil {
		fields = append(fields, "priority")
	}
	if upd.Type != nil {
		fields = append(fields, "type")
	}
	if upd.SetAssignee {
		fields = append(fields, "assignee")
	}
	if upd.Labels != nil {
		fields = append(fields, "labels")
	}
	if upd.SetSprint {
		fields = append(fields, "sprint")
	}
	if upd.SetParent {
		fields = append(fields, "parent")
	}
	if upd.SetPoints {
		fields = append(fields, "storyPoints")
	}
	if upd.DueDate != nil || upd.ClearDue {
		fields = append(fields, "duedate")
	}
	if upd.StartDate != nil || upd.ClearStart {
		fields = append(fields, "startDate")
	}
	return fields
}

func (s *Server) handleDeleteIssue(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "delete", &issue) {
		return
	}
	blobKeys, err := s.store.DeleteIssue(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "delete issue", err)
		return
	}
	for _, key := range blobKeys {
		if err := s.blobs.Delete(r.Context(), key); err != nil {
			s.log.Error("delete issue blob", "key", key, "error", err)
		}
	}
	s.publish(r, "issue.deleted", map[string]any{"key": issue.Key})
	w.WriteHeader(http.StatusNoContent)
}

// handleListTransitions mirrors Jira: available transitions from the current status.
func (s *Server) handleListTransitions(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	transitions, err := s.store.ListAvailableTransitions(r.Context(), issue.WorkflowID, issue.Status.ID)
	if err != nil {
		s.internalError(w, "list transitions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transitions": transitions})
}

type doTransitionRequest struct {
	Transition struct {
		ID string `json:"id"`
	} `json:"transition"`
}

func (s *Server) handleDoTransition(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "transition", &issue) {
		return
	}
	var req doTransitionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Transition.ID == "" {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"transition": "transition id required"})
		return
	}
	updated, err := s.store.TransitionIssue(r.Context(), issue.ID, req.Transition.ID, userIDFrom(r.Context()))
	if errors.Is(err, store.ErrTransitionNotAllowed) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"transition": "this move is not allowed by the space's workflow"})
		return
	}
	var ruleErr *store.RuleViolation
	if errors.As(err, &ruleErr) {
		status := http.StatusBadRequest
		if ruleErr.Forbidden {
			status = http.StatusForbidden
		}
		writeFieldErrors(w, status, map[string]string{"transition": ruleErr.Msg})
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeFieldErrors(w, http.StatusBadRequest, map[string]string{"transition": "not a valid transition for this issue"})
		return
	}
	if err != nil {
		s.internalError(w, "transition issue", err)
		return
	}
	s.publish(r, "issue.transitioned", updated)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleIssueChangelog(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	events, err := s.store.ListIssueEvents(r.Context(), issue.ID)
	if err != nil {
		s.internalError(w, "changelog", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": events})
}

// handleProjectIssues returns a Jira-style paginated list.
func (s *Server) handleProjectIssues(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	q := r.URL.Query()
	filter := store.IssueFilter{
		Query:      strings.TrimSpace(q.Get("query")),
		StatusID:   q.Get("status"),
		Type:       strings.ToLower(q.Get("type")),
		AssigneeID: q.Get("assignee"),
		StartAt:    intParam(q.Get("startAt"), 0),
		MaxResults: intParam(q.Get("maxResults"), 50),
	}
	if filter.MaxResults > 100 {
		filter.MaxResults = 100
	}
	issues, total, err := s.store.ListIssues(r.Context(), project.ID, filter)
	if err != nil {
		s.internalError(w, "list issues", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"startAt":    filter.StartAt,
		"maxResults": filter.MaxResults,
		"total":      total,
		"isLast":     filter.StartAt+len(issues) >= total,
		"values":     issues,
	})
}

func intParam(s string, fallback int) int {
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return fallback
	}
	return v
}

func normalizeLabels(labels []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, l := range labels {
		l = strings.TrimSpace(strings.ReplaceAll(l, " ", "-"))
		if l == "" || seen[l] {
			continue
		}
		seen[l] = true
		out = append(out, l)
	}
	return out
}

// handleTimeline feeds the Stage-20 roadmap view: all schedulable items in
// rank order plus their in-project "blocks" dependencies.
func (s *Server) handleTimeline(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	items, err := s.store.TimelineItems(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "timeline items", err)
		return
	}
	links, err := s.store.TimelineLinks(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "timeline links", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "links": links})
}
