package jiraimport

import (
	"encoding/json"
	"strings"
	"time"
)

// adfNode is a minimal view of Atlassian Document Format.
type adfNode struct {
	Type    string          `json:"type"`
	Text    string          `json:"text"`
	Content []adfNode       `json:"content"`
	Attrs   json.RawMessage `json:"attrs"`
	Marks   []adfMark       `json:"marks"`
}

type adfMark struct {
	Type  string          `json:"type"`
	Attrs json.RawMessage `json:"attrs"`
}

// ADFToText flattens an ADF document (Jira v3 rich text) into readable plain
// text: paragraphs and headings become lines, list items become "- " lines,
// unknown nodes degrade to their text content.
func ADFToText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	// Descriptions can also arrive as a plain string (API v2 / CSV).
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var doc adfNode
	if err := json.Unmarshal(raw, &doc); err != nil {
		return ""
	}
	var b strings.Builder
	renderADF(&b, doc, 0)
	return strings.TrimSpace(b.String())
}

func renderADF(b *strings.Builder, n adfNode, depth int) {
	switch n.Type {
	case "text":
		b.WriteString(n.Text)
	case "hardBreak":
		b.WriteString("\n")
	case "paragraph", "heading":
		for _, c := range n.Content {
			renderADF(b, c, depth)
		}
		b.WriteString("\n")
	case "listItem":
		b.WriteString(strings.Repeat("  ", depth) + "- ")
		for _, c := range n.Content {
			renderADF(b, c, depth+1)
		}
	case "codeBlock":
		for _, c := range n.Content {
			renderADF(b, c, depth)
		}
		b.WriteString("\n")
	case "mention":
		var attrs struct {
			Text string `json:"text"`
		}
		json.Unmarshal(n.Attrs, &attrs)
		b.WriteString(attrs.Text)
	default:
		for _, c := range n.Content {
			renderADF(b, c, depth)
		}
	}
}

// ---- ADF → TaskHat editor document (TipTap JSON) ----

type docNode = map[string]any

// ADFOptions carries the resolvers the conversion needs.
type ADFOptions struct {
	// ResolveMention maps a Jira accountId to a TaskHat user id + label;
	// unresolved mentions degrade to plain text.
	ResolveMention func(accountID string) (id, label string, ok bool)
}

// ADFToDoc converts an ADF document into the editor's TipTap JSON. Returns
// nil when the input is empty or not ADF (plain-string descriptions).
func ADFToDoc(raw json.RawMessage, opts ADFOptions) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return nil // plain text — caller keeps the text mirror
	}
	var doc struct {
		Type    string    `json:"type"`
		Content []adfNode `json:"content"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || doc.Type != "doc" {
		return nil
	}
	content := adfBlocks(doc.Content, opts)
	if len(content) == 0 {
		return nil
	}
	out, err := json.Marshal(docNode{"type": "doc", "content": content})
	if err != nil {
		return nil
	}
	return out
}

func adfAttrs(n adfNode) map[string]json.RawMessage {
	m := map[string]json.RawMessage{}
	if len(n.Attrs) > 0 {
		_ = json.Unmarshal(n.Attrs, &m)
	}
	return m
}

func adfAttrString(n adfNode, key string) string {
	var s string
	_ = json.Unmarshal(adfAttrs(n)[key], &s)
	return s
}

func adfAttrInt(n adfNode, key string) int {
	var i int
	_ = json.Unmarshal(adfAttrs(n)[key], &i)
	return i
}

// adfBlocks converts block-level nodes.
func adfBlocks(nodes []adfNode, opts ADFOptions) []docNode {
	var out []docNode
	for _, n := range nodes {
		switch n.Type {
		case "paragraph":
			out = append(out, docNode{"type": "paragraph", "content": adfInline(n.Content, opts)})
		case "heading":
			level := adfAttrInt(n, "level")
			if level < 1 || level > 6 {
				level = 2
			}
			out = append(out, docNode{"type": "heading", "attrs": docNode{"level": level}, "content": adfInline(n.Content, opts)})
		case "bulletList":
			out = append(out, docNode{"type": "bulletList", "content": adfBlocks(n.Content, opts)})
		case "orderedList":
			out = append(out, docNode{"type": "orderedList", "content": adfBlocks(n.Content, opts)})
		case "listItem":
			out = append(out, docNode{"type": "listItem", "content": adfBlocks(n.Content, opts)})
		case "taskList":
			out = append(out, docNode{"type": "taskList", "content": adfBlocks(n.Content, opts)})
		case "taskItem":
			out = append(out, docNode{"type": "taskItem",
				"attrs":   docNode{"checked": adfAttrString(n, "state") == "DONE"},
				"content": []docNode{{"type": "paragraph", "content": adfInline(n.Content, opts)}}})
		case "codeBlock":
			text := adfText(n)
			out = append(out, docNode{"type": "codeBlock", "content": []docNode{{"type": "text", "text": orSpace(text)}}})
		case "blockquote":
			out = append(out, docNode{"type": "blockquote", "content": adfBlocks(n.Content, opts)})
		case "rule":
			out = append(out, docNode{"type": "horizontalRule"})
		case "panel":
			pt := adfAttrString(n, "panelType")
			if pt == "" {
				pt = "info"
			}
			out = append(out, docNode{"type": "panel", "attrs": docNode{"panelType": pt}, "content": adfBlocks(n.Content, opts)})
		case "table":
			out = append(out, docNode{"type": "table", "content": adfBlocks(n.Content, opts)})
		case "tableRow":
			out = append(out, docNode{"type": "tableRow", "content": adfBlocks(n.Content, opts)})
		case "tableHeader":
			out = append(out, docNode{"type": "tableHeader", "content": adfBlocks(n.Content, opts)})
		case "tableCell":
			out = append(out, docNode{"type": "tableCell", "content": adfBlocks(n.Content, opts)})
		case "mediaSingle", "mediaGroup", "media":
			// Inline media needs Media Services ids we can't resolve; the
			// binary still arrives as an attachment.
			continue
		case "expand", "nestedExpand":
			// No expand node in the editor: keep the contents.
			out = append(out, adfBlocks(n.Content, opts)...)
		default:
			// Unknown block: keep the text so nothing is lost silently.
			if inline := adfInline(n.Content, opts); len(inline) > 0 {
				out = append(out, docNode{"type": "paragraph", "content": inline})
			} else if t := adfText(n); t != "" {
				out = append(out, docNode{"type": "paragraph", "content": []docNode{{"type": "text", "text": t}}})
			}
		}
	}
	return out
}

// adfInline converts inline nodes (text runs, mentions, chips).
func adfInline(nodes []adfNode, opts ADFOptions) []docNode {
	var out []docNode
	for _, n := range nodes {
		switch n.Type {
		case "text":
			if n.Text == "" {
				continue
			}
			node := docNode{"type": "text", "text": n.Text}
			if marks := adfMarks(n); len(marks) > 0 {
				node["marks"] = marks
			}
			out = append(out, node)
		case "hardBreak":
			out = append(out, docNode{"type": "hardBreak"})
		case "mention":
			acct := adfAttrString(n, "id")
			label := strings.TrimPrefix(adfAttrString(n, "text"), "@")
			if opts.ResolveMention != nil {
				if id, l, ok := opts.ResolveMention(acct); ok {
					out = append(out, docNode{"type": "mention", "attrs": docNode{"id": id, "label": l}})
					continue
				}
			}
			if label != "" {
				out = append(out, docNode{"type": "text", "text": "@" + label})
			}
		case "emoji":
			if t := adfAttrString(n, "text"); t != "" {
				out = append(out, docNode{"type": "text", "text": t})
			}
		case "status":
			out = append(out, docNode{"type": "statusChip", "attrs": docNode{
				"text":  strings.ToUpper(adfAttrString(n, "text")),
				"color": adfStatusColor(adfAttrString(n, "color")),
			}})
		case "date":
			// attrs.timestamp is epoch millis as a string.
			if ts := adfAttrString(n, "timestamp"); len(ts) >= 10 {
				if ms, err := jsonNumber(ts); err == nil {
					out = append(out, docNode{"type": "dateChip", "attrs": docNode{
						"date": msToDate(ms),
					}})
				}
			}
		case "inlineCard":
			if u := adfAttrString(n, "url"); u != "" {
				out = append(out, docNode{"type": "text", "text": u,
					"marks": []docNode{{"type": "link", "attrs": docNode{"href": u}}}})
			}
		default:
			if t := adfText(n); t != "" {
				out = append(out, docNode{"type": "text", "text": t})
			}
		}
	}
	return out
}

func adfMarks(n adfNode) []docNode {
	var out []docNode
	for _, m := range n.Marks {
		switch m.Type {
		case "strong":
			out = append(out, docNode{"type": "bold"})
		case "em":
			out = append(out, docNode{"type": "italic"})
		case "strike":
			out = append(out, docNode{"type": "strike"})
		case "underline":
			out = append(out, docNode{"type": "underline"})
		case "code":
			out = append(out, docNode{"type": "code"})
		case "link":
			var a struct {
				Href string `json:"href"`
			}
			_ = json.Unmarshal(m.Attrs, &a)
			out = append(out, docNode{"type": "link", "attrs": docNode{"href": a.Href}})
		case "textColor":
			var a struct {
				Color string `json:"color"`
			}
			_ = json.Unmarshal(m.Attrs, &a)
			out = append(out, docNode{"type": "textStyle", "attrs": docNode{"color": a.Color}})
		}
	}
	return out
}

func adfStatusColor(c string) string {
	switch strings.ToLower(c) {
	case "green":
		return "green"
	case "red":
		return "red"
	case "yellow":
		return "yellow"
	case "blue":
		return "blue"
	case "purple":
		return "purple"
	default:
		return "neutral"
	}
}

func jsonNumber(s string) (int64, error) {
	var n int64
	err := json.Unmarshal([]byte(s), &n)
	return n, err
}

func msToDate(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02")
}

func orSpace(s string) string {
	if s == "" {
		return " "
	}
	return s
}

// adfText flattens a node's entire subtree to plain text.
func adfText(n adfNode) string {
	var b strings.Builder
	var walk func(adfNode)
	walk = func(x adfNode) {
		if x.Text != "" {
			b.WriteString(x.Text)
		}
		for _, c := range x.Content {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}
