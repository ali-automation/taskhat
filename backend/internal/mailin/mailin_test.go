package mailin

import (
	"strings"
	"testing"
)

const sampleMIME = "From: Sara Hasan <sara@example.com>\r\n" +
	"To: support@example.com\r\n" +
	"Subject: Re: Printer on fire\r\n" +
	"MIME-Version: 1.0\r\n" +
	"Content-Type: multipart/mixed; boundary=\"BOUND\"\r\n" +
	"\r\n" +
	"--BOUND\r\n" +
	"Content-Type: text/plain; charset=utf-8\r\n" +
	"\r\n" +
	"It is very much on fire.\r\n" +
	"--BOUND\r\n" +
	"Content-Type: text/plain; name=\"log.txt\"\r\n" +
	"Content-Disposition: attachment; filename=\"log.txt\"\r\n" +
	"\r\n" +
	"line1\r\nline2\r\n" +
	"--BOUND--\r\n"

func TestParseMIME(t *testing.T) {
	m, err := parseMIME(strings.NewReader(sampleMIME))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if m.From != "sara@example.com" {
		t.Errorf("from = %q", m.From)
	}
	if m.Subject != "Re: Printer on fire" {
		t.Errorf("subject = %q", m.Subject)
	}
	if !strings.Contains(m.TextBody, "very much on fire") {
		t.Errorf("body = %q", m.TextBody)
	}
	if len(m.Attachments) != 1 || m.Attachments[0].Filename != "log.txt" ||
		!strings.Contains(string(m.Attachments[0].Data), "line1") {
		t.Errorf("attachments = %+v", m.Attachments)
	}
}

func TestSubjectHelpers(t *testing.T) {
	if got := rePrefixRe.ReplaceAllString("Re: Fwd:  RE: Server down", ""); got != "Server down" {
		t.Errorf("prefix strip = %q", got)
	}
	if m := issueKeyRe.FindStringSubmatch("RE: MS-12 printer"); m == nil || m[1] != "MS" || m[2] != "12" {
		t.Errorf("key match = %v", m)
	}
	if m := issueKeyRe.FindStringSubmatch("no key here"); m != nil {
		t.Errorf("false key match = %v", m)
	}
}
