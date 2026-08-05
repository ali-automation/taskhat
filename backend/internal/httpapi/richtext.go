package httpapi

import (
	"encoding/json"
	"strings"
)

// docNode is the minimal shape of a TipTap/ProseMirror node.
type docNode struct {
	Type    string          `json:"type"`
	Text    string          `json:"text"`
	Attrs   json.RawMessage `json:"attrs"`
	Content []docNode       `json:"content"`
}

// docText extracts a plain-text mirror from a TipTap document (for search,
// previews, CSV export and legacy clients).
func docText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var root docNode
	if json.Unmarshal(raw, &root) != nil {
		return ""
	}
	var b strings.Builder
	var walk func(n docNode)
	walk = func(n docNode) {
		switch n.Type {
		case "text":
			b.WriteString(n.Text)
		case "mention":
			var attrs struct {
				Label string `json:"label"`
			}
			_ = json.Unmarshal(n.Attrs, &attrs)
			if attrs.Label != "" {
				b.WriteString("@" + attrs.Label)
			}
		case "hardBreak":
			b.WriteString("\n")
		case "issueChip":
			var attrs struct {
				Key string `json:"key"`
			}
			_ = json.Unmarshal(n.Attrs, &attrs)
			b.WriteString(attrs.Key)
		}
		for _, c := range n.Content {
			walk(c)
		}
		switch n.Type {
		case "paragraph", "heading", "listItem", "blockquote", "codeBlock":
			b.WriteString("\n")
		}
	}
	walk(root)
	return strings.TrimSpace(b.String())
}

// docMentionIDs collects user ids from mention nodes.
func docMentionIDs(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var root docNode
	if json.Unmarshal(raw, &root) != nil {
		return nil
	}
	seen := map[string]bool{}
	ids := []string{}
	var walk func(n docNode)
	walk = func(n docNode) {
		if n.Type == "mention" {
			var attrs struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(n.Attrs, &attrs)
			if attrs.ID != "" && !seen[attrs.ID] {
				seen[attrs.ID] = true
				ids = append(ids, attrs.ID)
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(root)
	return ids
}

// docIssueKeys collects work-item keys referenced by smart chips.
func docIssueKeys(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var root docNode
	if json.Unmarshal(raw, &root) != nil {
		return nil
	}
	seen := map[string]bool{}
	keys := []string{}
	var walk func(n docNode)
	walk = func(n docNode) {
		if n.Type == "issueChip" {
			var attrs struct {
				Key string `json:"key"`
			}
			_ = json.Unmarshal(n.Attrs, &attrs)
			if attrs.Key != "" && !seen[attrs.Key] {
				seen[attrs.Key] = true
				keys = append(keys, attrs.Key)
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(root)
	return keys
}

// canvasText mirrors whiteboard text elements into the search index.
func canvasText(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var scene struct {
		Elements []struct {
			Text string `json:"text"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(raw, &scene); err != nil {
		return ""
	}
	var parts []string
	for _, e := range scene.Elements {
		if t := strings.TrimSpace(e.Text); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n")
}
