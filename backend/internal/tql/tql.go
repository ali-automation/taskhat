// Package tql implements TaskHat Query Language — a practical subset of JQL.
//
//	project = TH AND status != Done AND assignee = alice@example.com
//	type IN (bug, story) AND label = backend AND created >= -7d
//	text ~ "login flash" ORDER BY priority DESC
//
// Compile returns a parameterized WHERE fragment (with ? placeholders) and an
// ORDER BY clause over the canonical issue query joins:
// issues i, projects p, statuses s, users r (reporter), users a (assignee,
// LEFT), sprints sp (LEFT), issues par (parent, LEFT).
package tql

import (
	"regexp"
	"strconv"
	"strings"
"fmt"
)

type Query struct {
	Where   string // "" when no clauses (match all)
	Args    []any
	OrderBy string // always non-empty (defaults to rank)
}

type ParseError struct {
	Pos int
	Msg string
}

func (e *ParseError) Error() string { return fmt.Sprintf("TQL error at position %d: %s", e.Pos, e.Msg) }

// ---- lexer ----

type tokenKind int

const (
	tEOF tokenKind = iota
	tIdent
	tString
	tNumber
	tOp // = != ~ !~ > < >= <=
	tLParen
	tRParen
	tLBracket
	tRBracket
	tComma
)

type token struct {
	kind tokenKind
	val  string
	pos  int
}

func lex(input string) ([]token, error) {
	var tokens []token
	i := 0
	for i < len(input) {
		c := input[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n':
			i++
		case c == '(':
			tokens = append(tokens, token{tLParen, "(", i})
			i++
		case c == ')':
			tokens = append(tokens, token{tRParen, ")", i})
			i++
		case c == '[':
			tokens = append(tokens, token{tLBracket, "[", i})
			i++
		case c == ']':
			tokens = append(tokens, token{tRBracket, "]", i})
			i++
		case c == ',':
			tokens = append(tokens, token{tComma, ",", i})
			i++
		case c == '"' || c == '\'':
			quote := c
			j := i + 1
			for j < len(input) && input[j] != quote {
				j++
			}
			if j >= len(input) {
				return nil, &ParseError{i, "unterminated string"}
			}
			tokens = append(tokens, token{tString, input[i+1 : j], i})
			i = j + 1
		case c == '=':
			tokens = append(tokens, token{tOp, "=", i})
			i++
		case c == '~':
			tokens = append(tokens, token{tOp, "~", i})
			i++
		case c == '!':
			if i+1 < len(input) && input[i+1] == '=' {
				tokens = append(tokens, token{tOp, "!=", i})
				i += 2
			} else if i+1 < len(input) && input[i+1] == '~' {
				tokens = append(tokens, token{tOp, "!~", i})
				i += 2
			} else {
				return nil, &ParseError{i, "unexpected '!'"}
			}
		case c == '>' || c == '<':
			op := string(c)
			if i+1 < len(input) && input[i+1] == '=' {
				op += "="
				i++
			}
			tokens = append(tokens, token{tOp, op, i})
			i++
		default:
			if isWordChar(c) {
				j := i
				for j < len(input) && isWordChar(input[j]) {
					j++
				}
				word := input[i:j]
				tokens = append(tokens, token{tIdent, word, i})
				i = j
			} else {
				return nil, &ParseError{i, fmt.Sprintf("unexpected character %q", c)}
			}
		}
	}
	tokens = append(tokens, token{tEOF, "", len(input)})
	return tokens, nil
}

func isWordChar(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
		c == '_' || c == '-' || c == '.' || c == '@' || c == '+'
}

// ---- parser ----

// CustomFieldResolver maps a cf["Name"] reference to matching field ids.
type CustomFieldResolver func(name string) []string

type parser struct {
	tokens []token
	i      int
	args   []any
	cf     CustomFieldResolver
}

func (p *parser) cur() token  { return p.tokens[p.i] }
func (p *parser) next() token { t := p.tokens[p.i]; p.i++; return t }

func (p *parser) isKeyword(kw string) bool {
	t := p.cur()
	return t.kind == tIdent && strings.EqualFold(t.val, kw)
}

// Parse compiles a TQL string (without custom field support).
func Parse(input string) (Query, error) { return ParseWith(input, nil) }

// ParseWith compiles a TQL string; cf resolves cf["Field name"] references.
func ParseWith(input string, cf CustomFieldResolver) (Query, error) {
	input = strings.TrimSpace(input)
	tokens, err := lex(input)
	if err != nil {
		return Query{}, err
	}
	p := &parser{tokens: tokens, cf: cf}

	where := ""
	if !p.isKeyword("ORDER") && p.cur().kind != tEOF {
		where, err = p.parseOr()
		if err != nil {
			return Query{}, err
		}
	}

	orderBy := "i.rank ASC"
	if p.isKeyword("ORDER") {
		p.next()
		if !p.isKeyword("BY") {
			return Query{}, &ParseError{p.cur().pos, "expected BY after ORDER"}
		}
		p.next()
		orderBy, err = p.parseOrderBy()
		if err != nil {
			return Query{}, err
		}
	}
	if p.cur().kind != tEOF {
		return Query{}, &ParseError{p.cur().pos, fmt.Sprintf("unexpected %q", p.cur().val)}
	}
	return Query{Where: where, Args: p.args, OrderBy: orderBy}, nil
}

func (p *parser) parseOr() (string, error) {
	left, err := p.parseAnd()
	if err != nil {
		return "", err
	}
	for p.isKeyword("OR") {
		p.next()
		right, err := p.parseAnd()
		if err != nil {
			return "", err
		}
		left = "(" + left + " OR " + right + ")"
	}
	return left, nil
}

func (p *parser) parseAnd() (string, error) {
	left, err := p.parseClause()
	if err != nil {
		return "", err
	}
	for p.isKeyword("AND") {
		p.next()
		right, err := p.parseClause()
		if err != nil {
			return "", err
		}
		left = "(" + left + " AND " + right + ")"
	}
	return left, nil
}

func (p *parser) parseClause() (string, error) {
	if p.cur().kind == tLParen {
		p.next()
		inner, err := p.parseOr()
		if err != nil {
			return "", err
		}
		if p.cur().kind != tRParen {
			return "", &ParseError{p.cur().pos, "expected )"}
		}
		p.next()
		return inner, nil
	}

	fieldTok := p.cur()
	if fieldTok.kind != tIdent {
		return "", &ParseError{fieldTok.pos, "expected a field name"}
	}
	p.next()
	field := strings.ToLower(fieldTok.val)

	// cf["Field name"] — custom field reference.
	if field == "cf" && p.cur().kind == tLBracket {
		p.next()
		nameTok := p.cur()
		if nameTok.kind != tString {
			return "", &ParseError{nameTok.pos, `expected a quoted field name: cf["Field name"]`}
		}
		p.next()
		if p.cur().kind != tRBracket {
			return "", &ParseError{p.cur().pos, "expected ] after the field name"}
		}
		p.next()
		field = "cf:" + nameTok.val
	}

	// IN / NOT IN
	negate := false
	if p.isKeyword("NOT") {
		p.next()
		negate = true
	}
	if p.isKeyword("IN") {
		p.next()
		values, err := p.parseList()
		if err != nil {
			return "", err
		}
		return p.compileIn(field, values, negate, fieldTok.pos)
	}
	if negate {
		return "", &ParseError{p.cur().pos, "expected IN after NOT"}
	}

	opTok := p.cur()
	if opTok.kind != tOp {
		return "", &ParseError{opTok.pos, fmt.Sprintf("expected an operator after %q", field)}
	}
	p.next()

	valTok := p.cur()
	if valTok.kind != tIdent && valTok.kind != tString && valTok.kind != tNumber {
		return "", &ParseError{valTok.pos, "expected a value"}
	}
	p.next()
	return p.compileCmp(field, opTok.val, valTok, fieldTok.pos)
}

func (p *parser) parseList() ([]token, error) {
	if p.cur().kind != tLParen {
		return nil, &ParseError{p.cur().pos, "expected ( after IN"}
	}
	p.next()
	var values []token
	for {
		t := p.cur()
		if t.kind != tIdent && t.kind != tString {
			return nil, &ParseError{t.pos, "expected a value in list"}
		}
		values = append(values, t)
		p.next()
		if p.cur().kind == tComma {
			p.next()
			continue
		}
		break
	}
	if p.cur().kind != tRParen {
		return nil, &ParseError{p.cur().pos, "expected ) to close list"}
	}
	p.next()
	return values, nil
}

// ---- compilation ----

func isEmptyVal(t token) bool { return t.kind == tIdent && strings.EqualFold(t.val, "EMPTY") }

var relativeDateRe = regexp.MustCompile(`^-(\d+)d$`)
var absoluteDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func (p *parser) arg(v any) string {
	p.args = append(p.args, v)
	return "?"
}

// userMatch builds an EXISTS over users for assignee/reporter by email or name.
func (p *parser) userMatch(col string, val string) string {
	return "EXISTS (SELECT 1 FROM users tu WHERE tu.id = " + col +
		" AND (tu.email = " + p.arg(val) + " OR lower(tu.display_name) = lower(" + p.arg(val) + ")))"
}

func (p *parser) labelMatch(vals []string) string {
	placeholders := make([]string, len(vals))
	for i, v := range vals {
		placeholders[i] = p.arg(strings.ToLower(v))
	}
	return "EXISTS (SELECT 1 FROM issue_labels til JOIN labels tl ON tl.id = til.label_id" +
		" WHERE til.issue_id = i.id AND lower(tl.name) IN (" + strings.Join(placeholders, ", ") + "))"
}

func (p *parser) compileCmp(field, op string, val token, pos int) (string, error) {
	v := val.val
	if name, ok := strings.CutPrefix(field, "cf:"); ok {
		return p.compileCustomField(name, op, val, pos)
	}
	switch field {
	case "project":
		return p.simpleCmp("upper(p.key)", op, strings.ToUpper(v), pos)
	case "type", "issuetype":
		return p.simpleCmp("i.type", op, strings.ToLower(v), pos)
	case "priority":
		return p.simpleCmp("i.priority", op, strings.ToLower(v), pos)
	case "status":
		return p.simpleCmp("lower(s.name)", op, strings.ToLower(v), pos)
	case "key", "issuekey":
		return p.simpleCmp("(p.key || '-' || i.number)", op, strings.ToUpper(v), pos)
	case "resolution":
		if isEmptyVal(val) {
			return nullCmp("i.resolution", op, pos)
		}
		return p.simpleCmp("i.resolution", op, strings.ToLower(v), pos)
	case "assignee":
		if isEmptyVal(val) {
			return nullCmp("i.assignee_id", op, pos)
		}
		return p.negatable(p.userMatch("i.assignee_id", v), op, pos)
	case "reporter":
		return p.negatable(p.userMatch("i.reporter_id", v), op, pos)
	case "label", "labels":
		return p.negatable(p.labelMatch([]string{v}), op, pos)
	case "sprint":
		if isEmptyVal(val) {
			return nullCmp("i.sprint_id", op, pos)
		}
		return p.simpleCmp("lower(sp.name)", op, strings.ToLower(v), pos)
	case "timespent":
		if isEmptyVal(val) {
			match := "EXISTS (SELECT 1 FROM worklogs tw WHERE tw.issue_id = i.id)"
			switch op {
			case "=":
				return "NOT " + match, nil
			case "!=":
				return match, nil
			default:
				return "", &ParseError{pos, "EMPTY supports only = and !="}
			}
		}
		sec, derr := parseTQLDuration(v)
		if derr != nil {
			return "", &ParseError{pos, "timeSpent needs a duration like \"2h 30m\""}
		}
		expr := "COALESCE((SELECT sum(tw.seconds) FROM worklogs tw WHERE tw.issue_id = i.id), 0)"
		switch op {
		case "=", "!=", ">", "<", ">=", "<=":
			return expr + " " + op + " " + p.arg(sec), nil
		default:
			return "", &ParseError{pos, "timeSpent supports = != > < >= <="}
		}
	case "fixversion":
		if isEmptyVal(val) {
			match := "EXISTS (SELECT 1 FROM issue_fix_versions tfv WHERE tfv.issue_id = i.id)"
			switch op {
			case "=":
				return "NOT " + match, nil
			case "!=":
				return match, nil
			default:
				return "", &ParseError{pos, "EMPTY supports only = and !="}
			}
		}
		match := "EXISTS (SELECT 1 FROM issue_fix_versions tfv" +
			" JOIN versions tv ON tv.id = tfv.version_id" +
			" WHERE tfv.issue_id = i.id AND lower(tv.name) = " + p.arg(strings.ToLower(v)) + ")"
		return p.negatable(match, op, pos)
	case "linked":
		if isEmptyVal(val) {
			match := "EXISTS (SELECT 1 FROM issue_links tl WHERE tl.from_issue_id = i.id OR tl.to_issue_id = i.id)"
			switch op {
			case "=":
				return "NOT " + match, nil
			case "!=":
				return match, nil
			default:
				return "", &ParseError{pos, "EMPTY supports only = and !="}
			}
		}
		match := "EXISTS (SELECT 1 FROM issue_links tl" +
			" JOIN issues li ON li.id = CASE WHEN tl.from_issue_id = i.id THEN tl.to_issue_id ELSE tl.from_issue_id END" +
			" JOIN projects lp ON lp.id = li.project_id" +
			" WHERE (tl.from_issue_id = i.id OR tl.to_issue_id = i.id)" +
			" AND (lp.key || '-' || li.number) = " + p.arg(strings.ToUpper(v)) + ")"
		return p.negatable(match, op, pos)
	case "parent", "epic":
		if isEmptyVal(val) {
			return nullCmp("i.parent_id", op, pos)
		}
		match := "EXISTS (SELECT 1 FROM issues ti JOIN projects tp ON tp.id = ti.project_id" +
			" WHERE ti.id = i.parent_id AND (tp.key || '-' || ti.number) = " + p.arg(strings.ToUpper(v)) + ")"
		return p.negatable(match, op, pos)
	case "text", "summary":
		if op != "~" && op != "!~" {
			return "", &ParseError{pos, field + " supports only ~ and !~"}
		}
		match := "(i.search_tsv @@ websearch_to_tsquery('english', " + p.arg(v) +
			") OR i.summary ILIKE '%' || " + p.arg(v) + " || '%')"
		if op == "!~" {
			return "NOT " + match, nil
		}
		return match, nil
	case "created", "updated", "due", "start":
		col := map[string]string{"created": "i.created_at", "updated": "i.updated_at", "due": "i.due_date", "start": "i.start_date"}[field]
		if isEmptyVal(val) {
			return nullCmp(col, op, pos)
		}
		return p.dateCmp(col, op, v, pos)
	case "points", "storypoints":
		if !strings.ContainsAny(op, "=<>!") {
			return "", &ParseError{pos, "points supports = != > < >= <="}
		}
		return "COALESCE(i.story_points, 0) " + sqlOp(op) + " " + p.arg(v), nil
	default:
		return "", &ParseError{pos, fmt.Sprintf("unknown field %q", field)}
	}
}

// compileCustomField compiles cf["Name"] clauses against issue_field_values.
func (p *parser) compileCustomField(name, op string, val token, pos int) (string, error) {
	if p.cf == nil {
		return "", &ParseError{pos, "custom fields are not available here"}
	}
	ids := p.cf(name)
	if len(ids) == 0 {
		return "", &ParseError{pos, fmt.Sprintf("unknown custom field %q", name)}
	}
	idPh := make([]string, len(ids))
	for i, id := range ids {
		idPh[i] = p.arg(id)
	}
	base := "SELECT 1 FROM issue_field_values cfv WHERE cfv.issue_id = i.id" +
		" AND cfv.field_id::text IN (" + strings.Join(idPh, ", ") + ")"

	if isEmptyVal(val) {
		switch op {
		case "=":
			return "NOT EXISTS (" + base + ")", nil
		case "!=":
			return "EXISTS (" + base + ")", nil
		default:
			return "", &ParseError{pos, "EMPTY supports only = and !="}
		}
	}

	v := val.val
	switch op {
	case "=", "!=":
		expr := "EXISTS (" + base + " AND lower(cfv.value #>> '{}') = lower(" + p.arg(v) + "))"
		if op == "!=" {
			return "NOT " + expr, nil
		}
		return expr, nil
	case "~", "!~":
		expr := "EXISTS (" + base + " AND cfv.value #>> '{}' ILIKE '%' || " + p.arg(v) + " || '%')"
		if op == "!~" {
			return "NOT " + expr, nil
		}
		return expr, nil
	case ">", "<", ">=", "<=":
		return "EXISTS (" + base + " AND jsonb_typeof(cfv.value) = 'number'" +
			" AND (cfv.value #>> '{}')::numeric " + op + " " + p.arg(v) + ")", nil
	default:
		return "", &ParseError{pos, fmt.Sprintf("operator %s not supported for custom fields", op)}
	}
}

func (p *parser) compileIn(field string, values []token, negate bool, pos int) (string, error) {
	strs := make([]string, len(values))
	for i, t := range values {
		strs[i] = t.val
	}
	wrap := func(expr string) (string, error) {
		if negate {
			return "NOT " + expr, nil
		}
		return expr, nil
	}
	inList := func(col string, transform func(string) string) (string, error) {
		placeholders := make([]string, len(strs))
		for i, v := range strs {
			placeholders[i] = p.arg(transform(v))
		}
		return wrap(col + " IN (" + strings.Join(placeholders, ", ") + ")")
	}
	switch field {
	case "project":
		return inList("upper(p.key)", strings.ToUpper)
	case "type", "issuetype":
		return inList("i.type", strings.ToLower)
	case "priority":
		return inList("i.priority", strings.ToLower)
	case "status":
		return inList("lower(s.name)", strings.ToLower)
	case "key", "issuekey":
		return inList("(p.key || '-' || i.number)", strings.ToUpper)
	case "resolution":
		return inList("i.resolution", strings.ToLower)
	case "sprint":
		return inList("lower(sp.name)", strings.ToLower)
	case "label", "labels":
		return wrap(p.labelMatch(strs))
	case "assignee", "reporter":
		col := "i.assignee_id"
		if field == "reporter" {
			col = "i.reporter_id"
		}
		parts := make([]string, len(strs))
		for i, v := range strs {
			parts[i] = p.userMatch(col, v)
		}
		return wrap("(" + strings.Join(parts, " OR ") + ")")
	default:
		return "", &ParseError{pos, fmt.Sprintf("field %q does not support IN", field)}
	}
}

func (p *parser) simpleCmp(col, op, val string, pos int) (string, error) {
	switch op {
	case "=", "!=":
		return col + " " + sqlOp(op) + " " + p.arg(val), nil
	default:
		return "", &ParseError{pos, fmt.Sprintf("operator %s not supported for this field", op)}
	}
}

// negatable wraps an EXISTS-style match for = / !=.
func (p *parser) negatable(match, op string, pos int) (string, error) {
	switch op {
	case "=", "~":
		return match, nil
	case "!=", "!~":
		return "NOT " + match, nil
	default:
		return "", &ParseError{pos, fmt.Sprintf("operator %s not supported for this field", op)}
	}
}

func nullCmp(col, op string, pos int) (string, error) {
	switch op {
	case "=":
		return col + " IS NULL", nil
	case "!=":
		return col + " IS NOT NULL", nil
	default:
		return "", &ParseError{pos, "EMPTY supports only = and !="}
	}
}

func (p *parser) dateCmp(col, op, v string, pos int) (string, error) {
	if op == "~" || op == "!~" {
		return "", &ParseError{pos, "dates do not support ~"}
	}
	if m := relativeDateRe.FindStringSubmatch(v); m != nil {
		return col + " " + sqlOp(op) + " now() - (" + p.arg(m[1]) + " || ' days')::interval", nil
	}
	if absoluteDateRe.MatchString(v) {
		return col + " " + sqlOp(op) + " " + p.arg(v) + "::timestamptz", nil
	}
	return "", &ParseError{pos, fmt.Sprintf("bad date %q (use YYYY-MM-DD or -Nd)", v)}
}

func sqlOp(op string) string {
	if op == "!=" {
		return "<>"
	}
	return op
}

var orderFields = map[string]string{
	"rank":     "i.rank",
	"created":  "i.created_at",
	"updated":  "i.updated_at",
	"due":      "i.due_date",
	"start":    "i.start_date",
	"key":      "p.key, i.number",
	"status":   "s.position",
	"points":   "i.story_points",
	"priority": "CASE i.priority WHEN 'highest' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END",
}

func (p *parser) parseOrderBy() (string, error) {
	t := p.cur()
	if t.kind != tIdent {
		return "", &ParseError{t.pos, "expected a field after ORDER BY"}
	}
	col, ok := orderFields[strings.ToLower(t.val)]
	if !ok {
		return "", &ParseError{t.pos, fmt.Sprintf("cannot order by %q", t.val)}
	}
	p.next()
	dir := "ASC"
	if p.isKeyword("DESC") {
		dir = "DESC"
		p.next()
	} else if p.isKeyword("ASC") {
		p.next()
	}
	if strings.Contains(col, ",") { // composite (key)
		parts := strings.Split(col, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i]) + " " + dir
		}
		return strings.Join(parts, ", "), nil
	}
	return col + " " + dir, nil
}

// parseTQLDuration parses Jira-style durations ("2h 30m", 1w = 5d, 1d = 8h).
func parseTQLDuration(s string) (int64, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return 0, fmt.Errorf("empty")
	}
	units := map[byte]int64{'w': 5 * 8 * 3600, 'd': 8 * 3600, 'h': 3600, 'm': 60}
	var total int64
	for _, part := range strings.Fields(s) {
		u, okU := units[part[len(part)-1]]
		n, err := strconv.ParseFloat(part[:len(part)-1], 64)
		if !okU || err != nil || n < 0 {
			return 0, fmt.Errorf("bad duration")
		}
		total += int64(n * float64(u))
	}
	return total, nil
}
