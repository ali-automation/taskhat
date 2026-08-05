package tql

import (
	"strings"
	"testing"
)

func mustParse(t *testing.T, q string) Query {
	t.Helper()
	query, err := Parse(q)
	if err != nil {
		t.Fatalf("Parse(%q): %v", q, err)
	}
	return query
}

func TestSimpleEquality(t *testing.T) {
	q := mustParse(t, `project = TH`)
	if q.Where != "upper(p.key) = ?" {
		t.Errorf("where = %q", q.Where)
	}
	if len(q.Args) != 1 || q.Args[0] != "TH" {
		t.Errorf("args = %v", q.Args)
	}
	if q.OrderBy != "i.rank ASC" {
		t.Errorf("default order = %q", q.OrderBy)
	}
}

func TestAndOrPrecedence(t *testing.T) {
	q := mustParse(t, `project = TH AND status = done OR priority = high`)
	// AND binds tighter than OR
	if q.Where != "((upper(p.key) = ? AND lower(s.name) = ?) OR i.priority = ?)" {
		t.Errorf("where = %q", q.Where)
	}
}

func TestParens(t *testing.T) {
	q := mustParse(t, `project = TH AND (status = done OR status = "in progress")`)
	if !strings.Contains(q.Where, "AND (lower(s.name) = ? OR lower(s.name) = ?)") {
		t.Errorf("where = %q", q.Where)
	}
}

func TestInList(t *testing.T) {
	q := mustParse(t, `type IN (bug, story) AND status NOT IN ("Done")`)
	if !strings.Contains(q.Where, "i.type IN (?, ?)") || !strings.Contains(q.Where, "NOT lower(s.name) IN (?)") {
		t.Errorf("where = %q", q.Where)
	}
	if len(q.Args) != 3 || q.Args[0] != "bug" || q.Args[2] != "done" {
		t.Errorf("args = %v", q.Args)
	}
}

func TestAssigneeEmptyAndUser(t *testing.T) {
	q := mustParse(t, `assignee = EMPTY`)
	if q.Where != "i.assignee_id IS NULL" {
		t.Errorf("where = %q", q.Where)
	}
	q = mustParse(t, `assignee = alice@example.com`)
	if !strings.Contains(q.Where, "tu.email = ?") {
		t.Errorf("where = %q", q.Where)
	}
	q = mustParse(t, `assignee != "Sara Hasan"`)
	if !strings.HasPrefix(q.Where, "NOT EXISTS") {
		t.Errorf("where = %q", q.Where)
	}
}

func TestLabels(t *testing.T) {
	q := mustParse(t, `label = backend AND label != frontend`)
	if strings.Count(q.Where, "EXISTS (SELECT 1 FROM issue_labels") != 2 {
		t.Errorf("where = %q", q.Where)
	}
}

func TestTextSearch(t *testing.T) {
	q := mustParse(t, `text ~ "login flash"`)
	if !strings.Contains(q.Where, "websearch_to_tsquery") || !strings.Contains(q.Where, "ILIKE") {
		t.Errorf("where = %q", q.Where)
	}
	if _, err := Parse(`text = foo`); err == nil {
		t.Error("text = should be rejected")
	}
}

func TestDates(t *testing.T) {
	q := mustParse(t, `created >= -7d AND due < 2026-08-01`)
	if !strings.Contains(q.Where, "i.created_at >= now() - (? || ' days')::interval") {
		t.Errorf("where = %q", q.Where)
	}
	if !strings.Contains(q.Where, "i.due_date < ?::timestamptz") {
		t.Errorf("where = %q", q.Where)
	}
	if _, err := Parse(`created > yesterday`); err == nil {
		t.Error("bad date should be rejected")
	}
}

func TestOrderBy(t *testing.T) {
	q := mustParse(t, `project = TH ORDER BY priority DESC`)
	if !strings.HasPrefix(q.OrderBy, "CASE i.priority") || !strings.HasSuffix(q.OrderBy, "DESC") {
		t.Errorf("order = %q", q.OrderBy)
	}
	q = mustParse(t, `ORDER BY key DESC`)
	if q.Where != "" || q.OrderBy != "p.key DESC, i.number DESC" {
		t.Errorf("where=%q order=%q", q.Where, q.OrderBy)
	}
}

func TestEmptyQuery(t *testing.T) {
	q := mustParse(t, ``)
	if q.Where != "" || q.OrderBy != "i.rank ASC" {
		t.Errorf("empty query: where=%q order=%q", q.Where, q.OrderBy)
	}
}

func TestErrors(t *testing.T) {
	bad := []string{
		`project`, `project =`, `project = TH AND`, `bogusfield = x`,
		`status ~ done`, `project = TH ORDER BY bogus`, `type IN bug`,
		`project = "unterminated`,
	}
	for _, q := range bad {
		if _, err := Parse(q); err == nil {
			t.Errorf("Parse(%q) should fail", q)
		}
	}
}

func TestSprintAndParent(t *testing.T) {
	q := mustParse(t, `sprint = "SC Sprint 1" AND parent = SC-1`)
	if !strings.Contains(q.Where, "lower(sp.name) = ?") || !strings.Contains(q.Where, "ti.id = i.parent_id") {
		t.Errorf("where = %q", q.Where)
	}
	q = mustParse(t, `sprint = EMPTY`)
	if q.Where != "i.sprint_id IS NULL" {
		t.Errorf("where = %q", q.Where)
	}
}
