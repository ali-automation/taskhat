// Package automation executes flow rules: trigger → conditions → branches →
// actions, Jira-automation style. It runs in the worker, consuming every
// domain event plus a scheduler tick.
package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ali-automation/taskhat/backend/internal/config"
	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/realtime"
	"github.com/ali-automation/taskhat/backend/internal/store"
	"github.com/ali-automation/taskhat/backend/internal/tql"
)

const (
	maxThrottlePerMin = 60 // executions per rule per minute
	disableAfter      = 10 // consecutive failures before auto-disable
	maxBranchItems    = 50
)

type Engine struct {
	cfg       config.Config
	st        *store.Store
	rdb       *redis.Client
	publisher *events.Publisher
	hub       *realtime.Hub
	log       *slog.Logger
	client    *http.Client
	actorID   string
}

func New(cfg config.Config, st *store.Store, rdb *redis.Client, publisher *events.Publisher, hub *realtime.Hub, log *slog.Logger) *Engine {
	return &Engine{cfg: cfg, st: st, rdb: rdb, publisher: publisher, hub: hub, log: log,
		client: &http.Client{Timeout: 10 * time.Second}}
}

// ---- component model (mirrors the flow builder) ----

type Component struct {
	Kind       string          `json:"kind"` // condition | action | branch | ifelse
	Type       string          `json:"type"`
	Config     json.RawMessage `json:"config"`
	Components []Component     `json:"components,omitempty"` // branch / if body
	Else       []Component     `json:"else,omitempty"`       // ifelse else-body
}

type trigger struct {
	Type            string   `json:"type"`
	Events          []string `json:"events"`          // multiple
	ToStatusName    string   `json:"toStatusName"`    // issue.transitioned
	FromStatusName  string   `json:"fromStatusName"`  // issue.transitioned
	TQL             string   `json:"tql"`             // scheduled fan-out
	IntervalMinutes int      `json:"intervalMinutes"` // scheduled
	Fields          []string `json:"fields"`          // issue.field_changed
	Token           string   `json:"token"`           // incoming webhook
}

type runLine struct {
	Component string `json:"component"` // e.g. "condition:tql"
	Item      string `json:"item,omitempty"`
	Outcome   string `json:"outcome"` // passed | stopped | done | failed | skipped
	Detail    string `json:"detail,omitempty"`
}

type runState struct {
	lines   []runLine
	acted   bool
	failed  bool
	created *store.Issue // {{createdIssue.*}}
}

func (rs *runState) add(component, item, outcome, detail string) {
	rs.lines = append(rs.lines, runLine{Component: component, Item: item, Outcome: outcome, Detail: detail})
}

// ---- entry points ----

func (e *Engine) actor(ctx context.Context) string {
	if e.actorID == "" {
		id, err := e.st.AutomationActorID(ctx)
		if err != nil {
			e.log.Error("automation actor missing", "error", err)
			return ""
		}
		e.actorID = id
	}
	return e.actorID
}

// HandleEvent is the RabbitMQ consumer: match rules, run each.
func (e *Engine) HandleEvent(ev events.Event) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Manual and incoming-webhook triggers target one specific rule.
	if ev.Type == "automation.manual" || ev.Type == "automation.incoming" {
		return e.handleDirected(ctx, ev)
	}

	issue, ok := e.issueFromPayload(ctx, ev)
	projectKey := issue.ProjectKey
	if projectKey == "" {
		var v struct {
			ProjectKey string `json:"projectKey"`
		}
		_ = json.Unmarshal(ev.Payload, &v)
		projectKey = v.ProjectKey
	}
	rules, err := e.st.EnabledRulesForEvent(ctx, ev.Type, projectKey)
	if err != nil {
		return fmt.Errorf("rules lookup: %w", err)
	}
	for _, rule := range rules {
		// Loop prevention: automation-caused events don't re-trigger rules
		// unless the rule opts in.
		if ev.ActorID == e.actor(ctx) && !rule.AllowSelf {
			continue
		}
		if !ok && needsIssue(ev.Type) {
			continue
		}
		e.runRule(ctx, rule, ev.Type, issue, ev)
	}
	return nil
}

// handleDirected runs the single rule referenced in a manual / incoming event.
func (e *Engine) handleDirected(ctx context.Context, ev events.Event) error {
	var v struct {
		RuleID string `json:"ruleId"`
	}
	if json.Unmarshal(ev.Payload, &v) != nil || v.RuleID == "" {
		return nil
	}
	rule, err := e.st.GetAutomationRule(ctx, v.RuleID)
	if err != nil || !rule.IsEnabled {
		return nil
	}
	var trg trigger
	_ = json.Unmarshal(rule.Trigger, &trg)
	wantType := "manual"
	eventType := "manual"
	if ev.Type == "automation.incoming" {
		wantType, eventType = "incoming", "incoming"
	}
	if trg.Type != wantType {
		return nil
	}
	issue, _ := e.issueFromPayload(ctx, ev)
	if rule.ScopeProjectKey != nil && issue.ProjectKey != "" && issue.ProjectKey != *rule.ScopeProjectKey {
		return nil
	}
	e.runRule(ctx, rule, eventType, issue, ev)
	return nil
}

// Tick fires due scheduled rules (call every ~30s).
func (e *Engine) Tick(ctx context.Context) {
	rules, err := e.st.DueScheduledRules(ctx)
	if err != nil {
		e.log.Error("scheduled rules", "error", err)
		return
	}
	for _, rule := range rules {
		var trg trigger
		_ = json.Unmarshal(rule.Trigger, &trg)
		if strings.TrimSpace(trg.TQL) == "" {
			e.runRule(ctx, rule, "scheduled", store.Issue{}, events.Event{Type: "scheduled"})
			continue
		}
		q, err := tql.ParseWith(trg.TQL, e.cfResolver(ctx))
		if err != nil {
			e.recordFailure(ctx, rule, "scheduled", "", "invalid TQL: "+err.Error())
			continue
		}
		issues, err := e.st.SearchIssuesUnscoped(ctx, q.Where, q.Args, 100)
		if err != nil {
			e.recordFailure(ctx, rule, "scheduled", "", err.Error())
			continue
		}
		for _, issue := range issues {
			if rule.ScopeProjectKey != nil && issue.ProjectKey != *rule.ScopeProjectKey {
				continue
			}
			e.runRule(ctx, rule, "scheduled", issue, events.Event{Type: "scheduled"})
		}
	}
}

func needsIssue(eventType string) bool {
	switch eventType {
	case "project.created", "scheduled", "sprint.created", "sprint.started", "sprint.completed":
		return false
	}
	return true
}

func (e *Engine) issueFromPayload(ctx context.Context, ev events.Event) (store.Issue, bool) {
	if strings.HasPrefix(ev.Type, "comment.") {
		var v struct {
			Issue store.Issue `json:"issue"`
		}
		if json.Unmarshal(ev.Payload, &v) == nil && v.Issue.ID != "" {
			return v.Issue, true
		}
		return store.Issue{}, false
	}
	var issue store.Issue
	if json.Unmarshal(ev.Payload, &issue) == nil && issue.ID != "" {
		return issue, true
	}
	return store.Issue{}, false
}

func (e *Engine) recordFailure(ctx context.Context, rule store.AutomationRule, eventType, itemKey, detail string) {
	disabled, _ := e.st.RecordAutomationRun(ctx, rule.ID, eventType, itemKey, "failure",
		[]runLine{{Component: "flow", Outcome: "failed", Detail: detail}}, 0, disableAfter)
	e.notifyFailure(ctx, rule, detail, disabled)
}

// ---- rule execution ----

func (e *Engine) runRule(ctx context.Context, rule store.AutomationRule, eventType string, issue store.Issue, ev events.Event) {
	// Throttle per rule per minute.
	key := "automation:throttle:" + rule.ID
	if n, err := e.rdb.Incr(ctx, key).Result(); err == nil {
		if n == 1 {
			e.rdb.Expire(ctx, key, time.Minute)
		}
		if n > maxThrottlePerMin {
			return
		}
	}

	// Trigger refinement (e.g. transitioned to a specific status).
	var trg trigger
	_ = json.Unmarshal(rule.Trigger, &trg)
	if eventType == "issue.transitioned" {
		if trg.ToStatusName != "" && !strings.EqualFold(issue.Status.Name, trg.ToStatusName) {
			return
		}
	}
	if eventType == "issue.field_changed" && len(trg.Fields) > 0 {
		var v struct {
			ChangedFields []string `json:"changedFields"`
		}
		_ = json.Unmarshal(ev.Payload, &v)
		hit := false
		for _, changed := range v.ChangedFields {
			for _, want := range trg.Fields {
				if strings.EqualFold(changed, want) {
					hit = true
				}
			}
		}
		if !hit {
			return
		}
	}

	start := time.Now()
	rs := &runState{}
	var components []Component
	if err := json.Unmarshal(rule.Components, &components); err != nil {
		e.recordFailure(ctx, rule, eventType, issue.Key, "invalid components: "+err.Error())
		return
	}

	e.runChain(ctx, rule, components, issue, ev, rs)

	status := "success"
	switch {
	case rs.failed:
		status = "failure"
	case !rs.acted:
		status = "no_action"
	}
	disabled, _ := e.st.RecordAutomationRun(ctx, rule.ID, eventType, issue.Key, status, rs.lines,
		int(time.Since(start).Milliseconds()), disableAfter)
	if rs.failed {
		detail := ""
		for _, l := range rs.lines {
			if l.Outcome == "failed" {
				detail = l.Detail
				break
			}
		}
		e.notifyFailure(ctx, rule, detail, disabled)
	}
}

func (e *Engine) runChain(ctx context.Context, rule store.AutomationRule, chain []Component, issue store.Issue, ev events.Event, rs *runState) {
	for _, c := range chain {
		label := c.Kind + ":" + c.Type
		switch c.Kind {
		case "condition":
			ok, err := e.evalCondition(ctx, c, issue, ev)
			if err != nil {
				rs.add(label, issue.Key, "failed", err.Error())
				rs.failed = true
				return
			}
			if !ok {
				rs.add(label, issue.Key, "stopped", "condition not met")
				return
			}
			rs.add(label, issue.Key, "passed", "")
		case "branch":
			items, err := e.branchItems(ctx, c, issue, ev)
			if err != nil {
				rs.add(label, issue.Key, "failed", err.Error())
				rs.failed = true
				return
			}
			if len(items) == 0 {
				rs.add(label, issue.Key, "stopped", "no related items")
				continue
			}
			if len(items) > maxBranchItems {
				items = items[:maxBranchItems]
			}
			rs.add(label, issue.Key, "passed", fmt.Sprintf("%d item(s)", len(items)))
			for _, item := range items {
				e.runChain(ctx, rule, c.Components, item, ev, rs)
				if rs.failed {
					return
				}
			}
		case "ifelse":
			cond := Component{Kind: "condition", Type: c.Type, Config: c.Config}
			ok, err := e.evalCondition(ctx, cond, issue, ev)
			if err != nil {
				rs.add(label, issue.Key, "failed", err.Error())
				rs.failed = true
				return
			}
			if ok {
				rs.add(label, issue.Key, "passed", "IF path")
				e.runChain(ctx, rule, c.Components, issue, ev, rs)
			} else {
				rs.add(label, issue.Key, "passed", "ELSE path")
				e.runChain(ctx, rule, c.Else, issue, ev, rs)
			}
			if rs.failed {
				return
			}
		case "action":
			if err := e.runAction(ctx, rule, c, issue, ev, rs); err != nil {
				rs.add(label, issue.Key, "failed", err.Error())
				rs.failed = true
				return
			}
			rs.acted = true
		default:
			rs.add(label, issue.Key, "failed", "unknown component kind")
			rs.failed = true
			return
		}
	}
}

// ---- conditions ----

func (e *Engine) cfResolver(ctx context.Context) tql.CustomFieldResolver {
	return func(name string) []string {
		ids, err := e.st.CustomFieldIDsByName(ctx, name)
		if err != nil {
			return nil
		}
		return ids
	}
}

func (e *Engine) matchesTQL(ctx context.Context, issueID, query string) (bool, error) {
	q, err := tql.ParseWith(query, e.cfResolver(ctx))
	if err != nil {
		return false, fmt.Errorf("invalid TQL: %w", err)
	}
	return e.st.IssueMatchesTQL(ctx, issueID, q.Where, q.Args)
}

func (e *Engine) evalCondition(ctx context.Context, c Component, issue store.Issue, ev events.Event) (bool, error) {
	sv := e.smartValues(ctx, issue, ev, &runState{})
	switch c.Type {
	case "tql": // "If work item matches TQL"
		var cfg struct {
			TQL string `json:"tql"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		if issue.ID == "" {
			return false, nil
		}
		return e.matchesTQL(ctx, issue.ID, render(cfg.TQL, sv))
	case "parent-exists":
		return issue.Parent != nil, nil
	case "related": // all/any children|subtasks match TQL
		var cfg struct {
			Relation string `json:"relation"` // children | subtasks
			Match    string `json:"match"`    // all | any | none
			TQL      string `json:"tql"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		items, err := e.st.RelatedIssues(ctx, issue, cfg.Relation)
		if err != nil {
			return false, err
		}
		if len(items) == 0 {
			return cfg.Match == "none", nil
		}
		matches := 0
		for _, item := range items {
			ok, err := e.matchesTQL(ctx, item.ID, render(cfg.TQL, sv))
			if err != nil {
				return false, err
			}
			if ok {
				matches++
			}
		}
		switch cfg.Match {
		case "any":
			return matches > 0, nil
		case "none":
			return matches == 0, nil
		default: // all
			return matches == len(items), nil
		}
	case "actor": // user condition on the triggering actor
		var cfg struct {
			Email string `json:"email"`
			Is    bool   `json:"is"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		actor, err := e.st.GetUserByID(ctx, ev.ActorID)
		if err != nil {
			return !cfg.Is, nil
		}
		same := strings.EqualFold(actor.Email, cfg.Email)
		return same == cfg.Is, nil
	default:
		return false, fmt.Errorf("unknown condition %q", c.Type)
	}
}

func (e *Engine) branchItems(ctx context.Context, c Component, issue store.Issue, ev events.Event) ([]store.Issue, error) {
	// The branch relation is the component's type: parent | children |
	// subtasks | epic | tql.
	if c.Type == "tql" {
		var cfg struct {
			TQL string `json:"tql"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		sv := e.smartValues(ctx, issue, ev, &runState{})
		q, err := tql.ParseWith(render(cfg.TQL, sv), e.cfResolver(ctx))
		if err != nil {
			return nil, fmt.Errorf("invalid TQL: %w", err)
		}
		return e.st.SearchIssuesUnscoped(ctx, q.Where, q.Args, maxBranchItems)
	}
	if issue.ID == "" {
		return []store.Issue{}, nil
	}
	if c.Type == "linked" {
		return e.st.LinkedIssuesOf(ctx, issue.ID)
	}
	return e.st.RelatedIssues(ctx, issue, c.Type)
}
