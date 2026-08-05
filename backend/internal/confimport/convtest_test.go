package confimport

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEmoticonLink(t *testing.T) {
	src := `<p>Feeling <ac:emoticon ac:name="smile"/> about <ac:link><ri:page ri:content-title="Child page"/></ac:link>.</p>`
	c, err := Convert(src, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(c.Doc)
	if !strings.Contains(string(raw), "🙂") {
		t.Errorf("no emoji: %s", raw)
	}
	if !strings.Contains(string(raw), "Child page") {
		t.Errorf("no link text: %s", raw)
	}
}

func TestInlineImageResolution(t *testing.T) {
	src := `<p>Before <ac:image ac:width="300"><ri:attachment ri:filename="screen.png"/></ac:image> after.</p><p><ac:image><ri:url ri:value="https://ext.example/x.png"/></ac:image></p>`
	c, err := Convert(src, func(fn string) string {
		if fn == "screen.png" {
			return "/api/v1/wiki-images/abc"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(c.Doc)
	s := string(raw)
	for _, want := range []string{`"type":"image"`, `/api/v1/wiki-images/abc`, `"width":300`, `https://ext.example/x.png`, `"text":"Before "`, `"text":" after."`} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %s in %s", want, s)
		}
	}
	if c.SkippedImages != 0 {
		t.Errorf("skipped = %d", c.SkippedImages)
	}
}

func TestLayoutAndExpand(t *testing.T) {
	src := `<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><p>Left col</p></ac:layout-cell><ac:layout-cell><p>Right col</p></ac:layout-cell></ac:layout-section></ac:layout>` +
		`<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">More details</ac:parameter><ac:rich-text-body><p>Hidden text</p></ac:rich-text-body></ac:structured-macro>`
	c, err := Convert(src, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(c.Doc)
	s := string(raw)
	for _, want := range []string{`"type":"layoutSection"`, `"type":"layoutColumn"`, `Left col`, `Right col`, `"type":"expand"`, `More details`, `Hidden text`} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %s in %s", want, s)
		}
	}
}
