package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ali-automation/taskhat/backend/internal/store"
	"github.com/ali-automation/taskhat/backend/internal/tql"
)

var (
	automationTriggers = map[string]bool{
		"issue.created": true, "issue.updated": true, "issue.transitioned": true,
		"issue.deleted": true, "issue.field_changed": true, "issue.linked": true, "issue.link_deleted": true,
		"comment.added": true, "project.created": true, "scheduled": true, "multiple": true,
		"sprint.created": true, "sprint.started": true, "sprint.completed": true,
		"manual": true, "incoming": true,
	}
	automationConditions = map[string]bool{"tql": true, "parent-exists": true, "related": true, "actor": true}
	automationActions    = map[string]bool{"transition": true, "edit": true, "comment": true, "email": true, "webrequest": true, "create": true, "create_wiki_page": true}
	automationBranches   = map[string]bool{"parent": true, "children": true, "subtasks": true, "epic": true, "linked": true, "tql": true}
)

type automationComponent struct {
	Kind       string                `json:"kind"`
	Type       string                `json:"type"`
	Config     json.RawMessage       `json:"config"`
	Components []automationComponent `json:"components,omitempty"`
	Else       []automationComponent `json:"else,omitempty"`
}

func (s *Server) validateComponents(r *http.Request, comps []automationComponent, depth int) string {
	if depth > 3 {
		return "flows can nest branches at most 3 levels deep"
	}
	if len(comps) > 32 {
		return "a flow can have at most 32 components per level"
	}
	for _, c := range comps {
		switch c.Kind {
		case "condition":
			if !automationConditions[c.Type] {
				return "unknown condition: " + c.Type
			}
			if len(c.Components) > 0 {
				return "conditions cannot contain components"
			}
		case "action":
			if !automationActions[c.Type] {
				return "unknown action: " + c.Type
			}
			if len(c.Components) > 0 {
				return "actions cannot contain components"
			}
		case "branch":
			if !automationBranches[c.Type] {
				return "unknown branch relation: " + c.Type
			}
			if len(c.Components) == 0 {
				return "a branch needs at least one component inside it"
			}
			if msg := s.validateComponents(r, c.Components, depth+1); msg != "" {
				return msg
			}
		case "ifelse":
			if !automationConditions[c.Type] {
				return "if/else needs a valid condition type, got: " + c.Type
			}
			if len(c.Components) == 0 && len(c.Else) == 0 {
				return "an if/else block needs components in at least one path"
			}
			if msg := s.validateComponents(r, c.Components, depth+1); msg != "" {
				return msg
			}
			if msg := s.validateComponents(r, c.Else, depth+1); msg != "" {
				return msg
			}
		default:
			return "unknown component kind: " + c.Kind
		}
		// Validate embedded TQL early so broken queries fail at save time.
		var cfg struct {
			TQL string `json:"tql"`
		}
		if len(c.Config) > 0 {
			_ = json.Unmarshal(c.Config, &cfg)
		}
		if cfg.TQL != "" {
			if _, err := tql.ParseWith(cfg.TQL, s.cfResolver(r)); err != nil {
				return "invalid TQL in " + c.Kind + ": " + err.Error()
			}
		}
	}
	return ""
}

type automationRuleRequest struct {
	Name             string                `json:"name"`
	Description      string                `json:"description"`
	ScopeProjectKey  *string               `json:"scopeProjectKey"`
	OwnerID          *string               `json:"ownerId"`
	Trigger          json.RawMessage       `json:"trigger"`
	Components       []automationComponent `json:"components"`
	IsEnabled        bool                  `json:"isEnabled"`
	AllowSelfTrigger bool                  `json:"allowSelfTrigger"`
	NotifyOnError    string                `json:"notifyOnError"`
}

func (s *Server) parseAutomationRule(w http.ResponseWriter, r *http.Request) (store.AutomationRuleInput, bool) {
	var req automationRuleRequest
	if !decodeJSON(w, r, &req) {
		return store.AutomationRuleInput{}, false
	}
	req.Name = strings.TrimSpace(req.Name)
	fields := map[string]string{}
	if req.Name == "" {
		fields["name"] = "flow name required"
	}
	var trg struct {
		Type string   `json:"type"`
		TQL  string   `json:"tql"`
		Evs  []string `json:"events"`
	}
	if err := json.Unmarshal(req.Trigger, &trg); err != nil || !automationTriggers[trg.Type] {
		fields["trigger"] = "pick a valid trigger"
	}
	if trg.Type == "multiple" {
		for _, ev := range trg.Evs {
			if !automationTriggers[ev] || ev == "multiple" || ev == "scheduled" {
				fields["trigger"] = "invalid event in multiple-events trigger: " + ev
			}
		}
	}
	if trg.Type == "scheduled" && trg.TQL != "" {
		if _, err := tql.ParseWith(trg.TQL, s.cfResolver(r)); err != nil {
			fields["trigger"] = "invalid TQL in schedule: " + err.Error()
		}
	}
	if trg.Type == "incoming" {
		// Mint the webhook token once; keep it stable across edits.
		var full map[string]any
		_ = json.Unmarshal(req.Trigger, &full)
		if full == nil {
			full = map[string]any{"type": "incoming"}
		}
		if tok, _ := full["token"].(string); tok == "" {
			buf := make([]byte, 16)
			_, _ = rand.Read(buf)
			full["token"] = "in_" + hex.EncodeToString(buf)
		}
		req.Trigger, _ = json.Marshal(full)
	}
	if req.NotifyOnError == "" {
		req.NotifyOnError = "once"
	}
	if req.NotifyOnError != "once" && req.NotifyOnError != "always" && req.NotifyOnError != "never" {
		fields["notifyOnError"] = "must be once, always or never"
	}
	if msg := s.validateComponents(r, req.Components, 1); msg != "" {
		fields["components"] = msg
	}
	if req.OwnerID == nil || *req.OwnerID == "" {
		id := userIDFrom(r.Context())
		req.OwnerID = &id
	}
	if len(fields) > 0 {
		writeFieldErrors(w, http.StatusBadRequest, fields)
		return store.AutomationRuleInput{}, false
	}

	var projectID *string
	if req.ScopeProjectKey != nil && *req.ScopeProjectKey != "" {
		project, err := s.store.GetProjectByKey(r.Context(), strings.ToUpper(*req.ScopeProjectKey))
		if errors.Is(err, store.ErrNotFound) {
			writeFieldErrors(w, http.StatusBadRequest, map[string]string{"scopeProjectKey": "space not found"})
			return store.AutomationRuleInput{}, false
		}
		if err != nil {
			s.internalError(w, "project lookup", err)
			return store.AutomationRuleInput{}, false
		}
		projectID = &project.ID
	}

	components, err := json.Marshal(req.Components)
	if err != nil {
		s.internalError(w, "marshal components", err)
		return store.AutomationRuleInput{}, false
	}
	return store.AutomationRuleInput{
		Name:          req.Name,
		Description:   strings.TrimSpace(req.Description),
		ScopeProject:  projectID,
		OwnerID:       req.OwnerID,
		Trigger:       req.Trigger,
		Components:    components,
		IsEnabled:     req.IsEnabled,
		AllowSelf:     req.AllowSelfTrigger,
		NotifyOnError: req.NotifyOnError,
	}, true
}

func (s *Server) handleAdminListAutomation(w http.ResponseWriter, r *http.Request) {
	rules, err := s.store.ListAutomationRules(r.Context())
	if err != nil {
		s.internalError(w, "automation rules", err)
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) handleAdminGetAutomation(w http.ResponseWriter, r *http.Request) {
	rule, err := s.store.GetAutomationRule(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "flow not found")
		return
	}
	if err != nil {
		s.internalError(w, "get rule", err)
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) handleAdminCreateAutomation(w http.ResponseWriter, r *http.Request) {
	in, ok := s.parseAutomationRule(w, r)
	if !ok {
		return
	}
	rule, err := s.store.CreateAutomationRule(r.Context(), in, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create rule", err)
		return
	}
	s.audit(r, "automation.created", rule.Name, nil)
	writeJSON(w, http.StatusCreated, rule)
}

func (s *Server) handleAdminUpdateAutomation(w http.ResponseWriter, r *http.Request) {
	in, ok := s.parseAutomationRule(w, r)
	if !ok {
		return
	}
	rule, err := s.store.UpdateAutomationRule(r.Context(), chi.URLParam(r, "id"), in)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "flow not found")
		return
	}
	if err != nil {
		s.internalError(w, "update rule", err)
		return
	}
	s.audit(r, "automation.updated", rule.Name, nil)
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) handleAdminDeleteAutomation(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteAutomationRule(r.Context(), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "flow not found")
			return
		}
		s.internalError(w, "delete rule", err)
		return
	}
	s.audit(r, "automation.deleted", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminAutomationRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.store.ListAutomationRuns(r.Context(), chi.URLParam(r, "id"), 50)
	if err != nil {
		s.internalError(w, "runs", err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}


// ---- manual trigger (work item ⋯ menu) ----

type manualPayload struct {
	store.Issue
	RuleID string `json:"ruleId"`
}

func (s *Server) handleListManualFlows(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	rules, err := s.store.ManualRulesForProject(r.Context(), issue.ProjectKey)
	if err != nil {
		s.internalError(w, "manual flows", err)
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) handleRunManualFlow(w http.ResponseWriter, r *http.Request) {
	issue, _, ok := s.requireIssue(w, r)
	if !ok {
		return
	}
	if !s.requirePerm(w, r, issue.ProjectID, "edit", &issue) {
		return
	}
	rule, err := s.store.GetAutomationRule(r.Context(), chi.URLParam(r, "ruleId"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && !rule.IsEnabled) {
		writeError(w, http.StatusNotFound, "flow not found or disabled")
		return
	}
	if err != nil {
		s.internalError(w, "get flow", err)
		return
	}
	if rule.ScopeProjectKey != nil && *rule.ScopeProjectKey != issue.ProjectKey {
		writeError(w, http.StatusForbidden, "this flow does not apply to this space")
		return
	}
	s.publish(r, "automation.manual", manualPayload{Issue: issue, RuleID: rule.ID})
	s.audit(r, "automation.manual_run", rule.Name, map[string]any{"item": issue.Key})
	writeJSON(w, http.StatusAccepted, map[string]any{"queued": true})
}

// ---- incoming webhook trigger (public) ----

func (s *Server) handleIncomingAutomation(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if len(token) < 10 {
		writeError(w, http.StatusNotFound, "unknown webhook")
		return
	}
	// Cheap rate limit per token.
	key := "automation:incoming:" + token
	if n, err := s.rdb.Incr(r.Context(), key).Result(); err == nil {
		if n == 1 {
			s.rdb.Expire(r.Context(), key, time.Minute)
		}
		if n > 60 {
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
	}
	rule, err := s.store.RuleByIncomingToken(r.Context(), token)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "unknown webhook")
		return
	}
	if err != nil {
		s.internalError(w, "incoming lookup", err)
		return
	}
	var body struct {
		IssueKey string `json:"issueKey"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	payload := manualPayload{RuleID: rule.ID}
	if pk, num, ok := parseIssueKey(body.IssueKey); ok {
		if issue, err := s.store.GetIssueByKey(r.Context(), pk, num); err == nil {
			payload.Issue = issue
		}
	}
	s.publish(r, "automation.incoming", payload)
	writeJSON(w, http.StatusAccepted, map[string]any{"queued": true})
}

// ---- space-scoped automation (Space settings → Automation) ----

func (s *Server) handleSpaceListAutomation(w http.ResponseWriter, r *http.Request) {
	project, _, ok := s.requireProject(w, r, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	rules, err := s.store.ListAutomationRulesForProject(r.Context(), project.ID)
	if err != nil {
		s.internalError(w, "space automation", err)
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

// requireSpaceRule loads a rule and checks it is scoped to this space.
func (s *Server) requireSpaceRule(w http.ResponseWriter, r *http.Request, projectID string) (store.AutomationRule, bool) {
	rule, err := s.store.GetAutomationRule(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "flow not found")
		return store.AutomationRule{}, false
	}
	if err != nil {
		s.internalError(w, "get flow", err)
		return store.AutomationRule{}, false
	}
	if rule.ScopeProjectID == nil || *rule.ScopeProjectID != projectID {
		writeError(w, http.StatusForbidden, "global flows are managed by site administrators")
		return store.AutomationRule{}, false
	}
	return rule, true
}

func (s *Server) handleSpaceGetAutomation(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	rule, ok := s.requireSpaceRule(w, r, project.ID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) handleSpaceCreateAutomation(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	in, ok := s.parseAutomationRule(w, r)
	if !ok {
		return
	}
	in.ScopeProject = &project.ID // forced: space admins only manage their space
	rule, err := s.store.CreateAutomationRule(r.Context(), in, userIDFrom(r.Context()))
	if err != nil {
		s.internalError(w, "create flow", err)
		return
	}
	s.audit(r, "automation.created", rule.Name, map[string]any{"space": project.Key})
	writeJSON(w, http.StatusCreated, rule)
}

func (s *Server) handleSpaceUpdateAutomation(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	if _, ok := s.requireSpaceRule(w, r, project.ID); !ok {
		return
	}
	in, ok := s.parseAutomationRule(w, r)
	if !ok {
		return
	}
	in.ScopeProject = &project.ID
	rule, err := s.store.UpdateAutomationRule(r.Context(), chi.URLParam(r, "id"), in)
	if err != nil {
		s.internalError(w, "update flow", err)
		return
	}
	s.audit(r, "automation.updated", rule.Name, map[string]any{"space": project.Key})
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) handleSpaceDeleteAutomation(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	if _, ok := s.requireSpaceRule(w, r, project.ID); !ok {
		return
	}
	if err := s.store.DeleteAutomationRule(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.internalError(w, "delete flow", err)
		return
	}
	s.audit(r, "automation.deleted", chi.URLParam(r, "id"), map[string]any{"space": project.Key})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSpaceAutomationRuns(w http.ResponseWriter, r *http.Request) {
	project, ok := s.requireProjectAdmin(w, r)
	if !ok {
		return
	}
	if _, ok := s.requireSpaceRule(w, r, project.ID); !ok {
		return
	}
	runs, err := s.store.ListAutomationRuns(r.Context(), chi.URLParam(r, "id"), 50)
	if err != nil {
		s.internalError(w, "runs", err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}
