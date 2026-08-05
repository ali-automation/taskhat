package confimport

import (
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// The HTML parser ignores "/>" on unknown elements, so self-closing tags like
// <ac:emoticon/> would swallow the rest of their parent as children. Expand
// them to explicit open+close pairs before parsing.
var selfClosing = regexp.MustCompile(`<((?:ac|ri):[a-zA-Z0-9-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)/>`)

func expandSelfClosing(src string) string {
	return selfClosing.ReplaceAllString(src, "<$1$2></$1>")
}

// node is a TipTap document node.
type node = map[string]any

// Result of converting one storage-format body.
type Converted struct {
	Doc           node
	Text          string
	SkippedImages int
	SkippedMacros []string
}

// Convert turns Confluence storage-format XHTML into the editor's TipTap doc.
// Unknown macros are flattened to their rich-text body when they have one,
// otherwise skipped and reported. imageSrc maps an attachment filename to a
// served URL for inline images; nil (or "" results) counts them as skipped.
func Convert(src string, imageSrc func(filename string) string) (Converted, error) {
	ctxNode := &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body}
	nodes, err := html.ParseFragment(strings.NewReader(expandSelfClosing(src)), ctxNode)
	if err != nil {
		return Converted{}, err
	}
	c := &converter{imageSrc: imageSrc}
	blocks := c.blocks(nodes)
	if len(blocks) == 0 {
		blocks = []node{{"type": "paragraph"}}
	}
	doc := node{"type": "doc", "content": blocks}
	return Converted{Doc: doc, Text: docText(doc), SkippedImages: c.images, SkippedMacros: c.macros}, nil
}

type converter struct {
	images   int // ac:image occurrences that could not be resolved
	macros   []string
	imageSrc func(filename string) string
}

// imageNode resolves an <ac:image> to an image node, or nil when the source
// can't be determined (counted as skipped).
func (c *converter) imageNode(n *html.Node) node {
	attrs := node{}
	if w := attrOf(n, "ac:width"); w != "" {
		if px, err := strconv.Atoi(w); err == nil && px > 0 {
			attrs["width"] = px
		}
	}
	if ext := childElem(n, "ri:url"); ext != nil {
		if src := attrOf(ext, "ri:value"); src != "" {
			attrs["src"] = src
			return node{"type": "image", "attrs": attrs}
		}
	}
	if att := childElem(n, "ri:attachment"); att != nil && c.imageSrc != nil {
		if src := c.imageSrc(attrOf(att, "ri:filename")); src != "" {
			attrs["src"] = src
			return node{"type": "image", "attrs": attrs}
		}
	}
	c.images++
	return nil
}

func attrOf(n *html.Node, name string) string {
	for _, a := range n.Attr {
		key := a.Key
		if a.Namespace != "" {
			key = a.Namespace + ":" + a.Key
		}
		if key == name {
			return a.Val
		}
	}
	return ""
}

func childElem(n *html.Node, name string) *html.Node {
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		if ch.Type == html.ElementNode && ch.Data == name {
			return ch
		}
	}
	return nil
}

// rawText collects text content, including CDATA sections that the HTML
// parser surfaces as comment nodes ("[CDATA[…]]").
func rawText(n *html.Node) string {
	if n == nil {
		return ""
	}
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(x *html.Node) {
		switch x.Type {
		case html.TextNode:
			b.WriteString(x.Data)
		case html.CommentNode:
			d := strings.TrimSuffix(strings.TrimPrefix(x.Data, "[CDATA["), "]]")
			b.WriteString(d)
		}
		for ch := x.FirstChild; ch != nil; ch = ch.NextSibling {
			walk(ch)
		}
	}
	walk(n)
	return b.String()
}

var panelTypes = map[string]string{
	"info": "info", "note": "note", "tip": "success",
	"warning": "warning", "error": "error", "panel": "info",
}

var emoticons = map[string]string{
	"smile": "🙂", "sad": "🙁", "cheeky": "😛", "laugh": "😆", "wink": "😉",
	"thumbs-up": "👍", "thumbs-down": "👎", "information": "ℹ️", "tick": "✅",
	"cross": "❌", "warning": "⚠️", "plus": "➕", "minus": "➖", "question": "❓",
	"light-on": "💡", "yellow-star": "⭐", "heart": "❤️", "broken-heart": "💔",
}

// blocks converts a sibling list into TipTap block nodes; loose inline
// content is gathered into paragraphs.
func (c *converter) blocks(nodes []*html.Node) []node {
	var out []node
	var pending []node
	flush := func() {
		if len(pending) > 0 {
			out = append(out, node{"type": "paragraph", "content": pending})
			pending = nil
		}
	}
	for _, n := range nodes {
		switch n.Type {
		case html.TextNode:
			if strings.TrimSpace(n.Data) != "" {
				pending = append(pending, textNode(n.Data, nil))
			}
			continue
		case html.ElementNode:
		default:
			continue
		}
		switch n.Data {
		case "p":
			flush()
			// Through blocks(): inline runs gather into paragraphs while
			// ac:image children hoist out as block image nodes.
			out = append(out, c.blocksOf(n)...)
		case "h1", "h2", "h3", "h4", "h5", "h6":
			flush()
			level := int(n.Data[1] - '0')
			if level > 3 {
				level = 3
			}
			out = append(out, node{"type": "heading", "attrs": node{"level": level}, "content": c.inline(n, nil)})
		case "ul", "ol":
			flush()
			listType := "bulletList"
			if n.Data == "ol" {
				listType = "orderedList"
			}
			var items []node
			for li := n.FirstChild; li != nil; li = li.NextSibling {
				if li.Type == html.ElementNode && li.Data == "li" {
					items = append(items, node{"type": "listItem", "content": c.blocksOf(li)})
				}
			}
			if len(items) > 0 {
				out = append(out, node{"type": listType, "content": items})
			}
		case "table":
			flush()
			if tbl := c.table(n); tbl != nil {
				out = append(out, tbl)
			}
		case "blockquote":
			flush()
			out = append(out, node{"type": "blockquote", "content": c.blocksOf(n)})
		case "pre":
			flush()
			out = append(out, codeBlock("", rawText(n)))
		case "hr":
			flush()
			out = append(out, node{"type": "horizontalRule"})
		case "ac:structured-macro", "ac:macro":
			flush()
			out = append(out, c.macro(n)...)
		case "ac:task-list":
			flush()
			if tl := c.taskList(n); tl != nil {
				out = append(out, tl)
			}
		case "ac:image":
			flush()
			if img := c.imageNode(n); img != nil {
				out = append(out, img)
			}
		case "ac:layout":
			flush()
			for sec := n.FirstChild; sec != nil; sec = sec.NextSibling {
				if sec.Type == html.ElementNode && sec.Data == "ac:layout-section" {
					out = append(out, c.layoutSection(sec)...)
				}
			}
		case "ac:layout-section":
			flush()
			out = append(out, c.layoutSection(n)...)
		case "ac:layout-cell", "div", "section", "article", "tbody":
			flush()
			out = append(out, c.blocksOf(n)...)
		default:
			// Inline element at block level — gather into the pending paragraph.
			pending = append(pending, c.inlineOne(n, nil)...)
		}
	}
	flush()
	return out
}

func (c *converter) blocksOf(n *html.Node) []node {
	var kids []*html.Node
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		kids = append(kids, ch)
	}
	blocks := c.blocks(kids)
	if len(blocks) == 0 {
		blocks = []node{{"type": "paragraph"}}
	}
	return blocks
}

func (c *converter) macro(n *html.Node) []node {
	name := attrOf(n, "ac:name")
	if pt, ok := panelTypes[name]; ok {
		body := childElem(n, "ac:rich-text-body")
		content := []node{{"type": "paragraph"}}
		if body != nil {
			content = c.blocksOf(body)
		}
		return []node{{"type": "panel", "attrs": node{"panelType": pt}, "content": content}}
	}
	switch name {
	case "code":
		lang := ""
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			if ch.Type == html.ElementNode && ch.Data == "ac:parameter" && attrOf(ch, "ac:name") == "language" {
				lang = strings.TrimSpace(rawText(ch))
			}
		}
		return []node{codeBlock(lang, rawText(childElem(n, "ac:plain-text-body")))}
	case "status":
		title, colour := "", "neutral"
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			if ch.Type == html.ElementNode && ch.Data == "ac:parameter" {
				switch attrOf(ch, "ac:name") {
				case "title":
					title = strings.TrimSpace(rawText(ch))
				case "colour", "color":
					switch strings.ToLower(strings.TrimSpace(rawText(ch))) {
					case "red":
						colour = "red"
					case "yellow":
						colour = "yellow"
					case "green":
						colour = "green"
					case "blue":
						colour = "blue"
					case "purple":
						colour = "purple"
					}
				}
			}
		}
		if title != "" {
			return []node{{"type": "paragraph", "content": []node{
				{"type": "statusChip", "attrs": node{"text": strings.ToUpper(title), "color": colour}},
			}}}
		}
		return nil
	case "expand":
		title := ""
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			if ch.Type == html.ElementNode && ch.Data == "ac:parameter" && attrOf(ch, "ac:name") == "title" {
				title = strings.TrimSpace(rawText(ch))
			}
		}
		content := []node{{"type": "paragraph"}}
		if body := childElem(n, "ac:rich-text-body"); body != nil {
			content = c.blocksOf(body)
		}
		return []node{{"type": "expand", "attrs": node{"title": title}, "content": content}}
	case "excerpt", "column", "section-macro":
		if body := childElem(n, "ac:rich-text-body"); body != nil {
			return c.blocksOf(body)
		}
		return nil
	default:
		// Any other macro: keep its rich body if present, else skip + report.
		if body := childElem(n, "ac:rich-text-body"); body != nil {
			return c.blocksOf(body)
		}
		c.macros = append(c.macros, name)
		return nil
	}
}

// layoutSection maps a Confluence layout section to a column layout;
// single-cell sections flatten, >3 cells flatten too (our layouts are 2–3).
func (c *converter) layoutSection(sec *html.Node) []node {
	var cells []*html.Node
	for cell := sec.FirstChild; cell != nil; cell = cell.NextSibling {
		if cell.Type == html.ElementNode && cell.Data == "ac:layout-cell" {
			cells = append(cells, cell)
		}
	}
	if len(cells) < 2 || len(cells) > 3 {
		var out []node
		for _, cell := range cells {
			out = append(out, c.blocksOf(cell)...)
		}
		if len(cells) == 0 {
			out = c.blocksOf(sec)
		}
		return out
	}
	cols := make([]node, 0, len(cells))
	for _, cell := range cells {
		cols = append(cols, node{"type": "layoutColumn", "content": c.blocksOf(cell)})
	}
	return []node{{"type": "layoutSection", "content": cols}}
}

func (c *converter) taskList(n *html.Node) node {
	var items []node
	for task := n.FirstChild; task != nil; task = task.NextSibling {
		if task.Type != html.ElementNode || task.Data != "ac:task" {
			continue
		}
		checked := strings.TrimSpace(rawText(childElem(task, "ac:task-status"))) == "complete"
		body := childElem(task, "ac:task-body")
		content := []node{{"type": "paragraph"}}
		if body != nil {
			if inl := c.inline(body, nil); len(inl) > 0 {
				content = []node{{"type": "paragraph", "content": inl}}
			}
		}
		items = append(items, node{"type": "taskItem", "attrs": node{"checked": checked}, "content": content})
	}
	if len(items) == 0 {
		return nil
	}
	return node{"type": "taskList", "content": items}
}

func (c *converter) table(n *html.Node) node {
	var rows []node
	var walkRows func(*html.Node)
	walkRows = func(x *html.Node) {
		for ch := x.FirstChild; ch != nil; ch = ch.NextSibling {
			if ch.Type != html.ElementNode {
				continue
			}
			switch ch.Data {
			case "thead", "tbody", "tfoot":
				walkRows(ch)
			case "tr":
				var cells []node
				for cell := ch.FirstChild; cell != nil; cell = cell.NextSibling {
					if cell.Type != html.ElementNode || (cell.Data != "td" && cell.Data != "th") {
						continue
					}
					kind := "tableCell"
					if cell.Data == "th" {
						kind = "tableHeader"
					}
					cells = append(cells, node{"type": kind, "content": c.blocksOf(cell)})
				}
				if len(cells) > 0 {
					rows = append(rows, node{"type": "tableRow", "content": cells})
				}
			}
		}
	}
	walkRows(n)
	if len(rows) == 0 {
		return nil
	}
	return node{"type": "table", "content": rows}
}

// inline converts an element's children into inline nodes with mark stacking.
func (c *converter) inline(n *html.Node, marks []node) []node {
	var out []node
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		out = append(out, c.inlineOne(ch, marks)...)
	}
	return out
}

// inlineOne converts a single node in inline position.
func (c *converter) inlineOne(ch *html.Node, marks []node) []node {
	var out []node
	{
		switch ch.Type {
		case html.TextNode:
			if ch.Data != "" {
				out = append(out, textNode(ch.Data, marks))
			}
		case html.CommentNode:
			if d := strings.TrimSuffix(strings.TrimPrefix(ch.Data, "[CDATA["), "]]"); strings.HasPrefix(ch.Data, "[CDATA[") && d != "" {
				out = append(out, textNode(d, marks))
			}
		case html.ElementNode:
			switch ch.Data {
			case "strong", "b":
				out = append(out, c.inline(ch, addMark(marks, node{"type": "bold"}))...)
			case "em", "i":
				out = append(out, c.inline(ch, addMark(marks, node{"type": "italic"}))...)
			case "u", "ins":
				out = append(out, c.inline(ch, addMark(marks, node{"type": "underline"}))...)
			case "s", "del", "strike":
				out = append(out, c.inline(ch, addMark(marks, node{"type": "strike"}))...)
			case "code":
				out = append(out, c.inline(ch, addMark(marks, node{"type": "code"}))...)
			case "a":
				if href := attrOf(ch, "href"); href != "" {
					out = append(out, c.inline(ch, addMark(marks, node{"type": "link", "attrs": node{"href": href}}))...)
				} else {
					out = append(out, c.inline(ch, marks)...)
				}
			case "br":
				out = append(out, node{"type": "hardBreak"})
			case "time":
				if dt := attrOf(ch, "datetime"); dt != "" {
					out = append(out, textNode(dt, marks))
				}
			case "ac:link":
				if txt := linkText(ch); txt != "" {
					out = append(out, textNode(txt, marks))
				}
			case "ac:emoticon":
				if fb := attrOf(ch, "ac:emoji-fallback"); fb != "" {
					out = append(out, textNode(fb, marks))
				} else if e := emoticons[attrOf(ch, "ac:name")]; e != "" {
					out = append(out, textNode(e, marks))
				} else if e := decodeEmoji(attrOf(ch, "ac:emoji-id")); e != "" {
					out = append(out, textNode(e, marks))
				}
				// Defensive: content a parser quirk nested under the emoticon.
				out = append(out, c.inline(ch, marks)...)
			case "ac:image":
				// Nested inside marks — can't hoist a block image from here.
				c.images++
			case "ri:user":
				out = append(out, textNode("@user", marks))
			default:
				out = append(out, c.inline(ch, marks)...)
			}
		}
	}
	return out
}

// linkText extracts a readable label from an <ac:link>.
func linkText(n *html.Node) string {
	if body := childElem(n, "ac:plain-text-link-body"); body != nil {
		if t := strings.TrimSpace(rawText(body)); t != "" {
			return t
		}
	}
	if body := childElem(n, "ac:link-body"); body != nil {
		if t := strings.TrimSpace(rawText(body)); t != "" {
			return t
		}
	}
	if pg := childElem(n, "ri:page"); pg != nil {
		return attrOf(pg, "ri:content-title")
	}
	if att := childElem(n, "ri:attachment"); att != nil {
		return attrOf(att, "ri:filename")
	}
	return strings.TrimSpace(rawText(n))
}

func addMark(marks []node, m node) []node {
	out := make([]node, len(marks), len(marks)+1)
	copy(out, marks)
	return append(out, m)
}

func textNode(text string, marks []node) node {
	t := node{"type": "text", "text": text}
	if len(marks) > 0 {
		t["marks"] = marks
	}
	return t
}

func codeBlock(lang, text string) node {
	text = strings.Trim(text, "\n")
	cb := node{"type": "codeBlock"}
	if lang != "" {
		cb["attrs"] = node{"language": lang}
	}
	if text != "" {
		cb["content"] = []node{{"type": "text", "text": text}}
	}
	return cb
}

// docText mirrors the server's plain-text derivation for search/preview.
func docText(doc node) string {
	var b strings.Builder
	var walk func(n node)
	walk = func(n node) {
		if t, _ := n["type"].(string); t == "text" {
			if s, _ := n["text"].(string); s != "" {
				b.WriteString(s)
			}
			return
		} else if t == "hardBreak" {
			b.WriteString("\n")
			return
		}
		if content, ok := n["content"].([]node); ok {
			for _, ch := range content {
				walk(ch)
			}
		}
		switch n["type"] {
		case "paragraph", "heading", "listItem", "taskItem", "tableRow", "codeBlock":
			b.WriteString("\n")
		}
	}
	walk(doc)
	return strings.TrimSpace(strings.ReplaceAll(b.String(), "\n\n\n", "\n\n"))
}
