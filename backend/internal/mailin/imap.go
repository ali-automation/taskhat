package mailin

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	gomail "github.com/emersion/go-message/mail"

	"github.com/ali-automation/taskhat/backend/internal/store"
)

// PollAll runs one poll cycle over every enabled IMAP handler.
func (p *Processor) PollAll(ctx context.Context) {
	handlers, err := p.St.ListMailHandlers(ctx)
	if err != nil {
		p.Log.Error("mailin list handlers", "error", err)
		return
	}
	for _, h := range handlers {
		if !h.IsEnabled || h.Mode != "imap" || h.IMAP.Host == "" {
			continue
		}
		processed, err := p.pollOne(ctx, h)
		errStr := ""
		if err != nil {
			errStr = err.Error()
			p.Log.Error("mailin poll", "handler", h.Name, "error", err)
		}
		p.St.RecordMailResult(ctx, h.ID, processed, errStr)
	}
}

// pollOne fetches unseen messages from the handler's mailbox. Fetching
// BODY[] (non-PEEK) marks them \Seen, so each message is handled once.
func (p *Processor) pollOne(ctx context.Context, h store.MailHandler) (int, error) {
	port := h.IMAP.Port
	if port == 0 {
		if h.IMAP.TLS {
			port = 993
		} else {
			port = 143
		}
	}
	addr := fmt.Sprintf("%s:%d", h.IMAP.Host, port)

	var c *client.Client
	var err error
	if h.IMAP.TLS {
		c, err = client.DialTLS(addr, nil)
	} else {
		c, err = client.Dial(addr)
	}
	if err != nil {
		return 0, fmt.Errorf("connect %s: %w", addr, err)
	}
	defer c.Logout()
	c.Timeout = 30 * time.Second

	if err := c.Login(h.IMAP.Username, h.IMAP.Password); err != nil {
		return 0, fmt.Errorf("login: %w", err)
	}
	folder := h.IMAP.Folder
	if folder == "" {
		folder = "INBOX"
	}
	if _, err := c.Select(folder, false); err != nil {
		return 0, fmt.Errorf("select %s: %w", folder, err)
	}

	criteria := imap.NewSearchCriteria()
	criteria.WithoutFlags = []string{imap.SeenFlag}
	ids, err := c.Search(criteria)
	if err != nil {
		return 0, fmt.Errorf("search: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil
	}
	if len(ids) > 25 { // keep one poll cycle bounded
		ids = ids[:25]
	}

	seqset := new(imap.SeqSet)
	seqset.AddNum(ids...)
	section := &imap.BodySectionName{}
	messages := make(chan *imap.Message, 10)
	done := make(chan error, 1)
	go func() { done <- c.Fetch(seqset, []imap.FetchItem{section.FetchItem()}, messages) }()

	processed := 0
	var firstErr error
	for msg := range messages {
		body := msg.GetBody(section)
		if body == nil {
			continue
		}
		m, err := parseMIME(body)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if _, err := p.Process(ctx, h, m); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		processed++
	}
	if err := <-done; err != nil && firstErr == nil {
		firstErr = fmt.Errorf("fetch: %w", err)
	}
	return processed, firstErr
}

// parseMIME extracts sender, subject, the first text part, and attachments.
func parseMIME(r io.Reader) (Mail, error) {
	var m Mail
	mr, err := gomail.CreateReader(r)
	if err != nil {
		return m, fmt.Errorf("mime: %w", err)
	}
	m.Subject, _ = mr.Header.Subject()
	if addrs, err := mr.Header.AddressList("From"); err == nil && len(addrs) > 0 {
		m.From = addrs[0].Address
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break // tolerate malformed trailing parts
		}
		switch h := part.Header.(type) {
		case *gomail.InlineHeader:
			ct, _, _ := h.ContentType()
			if m.TextBody == "" && (ct == "text/plain" || ct == "") {
				data, _ := io.ReadAll(io.LimitReader(part.Body, maxBodyChars+1024))
				m.TextBody = string(data)
			}
		case *gomail.AttachmentHeader:
			filename, _ := h.Filename()
			ct, _, _ := h.ContentType()
			data, _ := io.ReadAll(io.LimitReader(part.Body, MaxAttachmentSize+1))
			m.Attachments = append(m.Attachments, Attachment{Filename: filename, ContentType: ct, Data: data})
		}
	}
	return m, nil
}
