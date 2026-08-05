// Package mailer sends plain-text email over SMTP. Supports unauthenticated
// relays (MailHog in dev), SMTP AUTH (PLAIN) with STARTTLS on submission
// ports, and implicit TLS on port 465.
package mailer

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
)

// Config is a resolved outgoing-mail configuration. Username == "" disables
// authentication.
type Config struct {
	Addr     string // host:port, e.g. smtp.company.com:587; empty disables email
	From     string
	Username string
	Password string
}

// Enabled reports whether outgoing mail is configured at all.
func (c Config) Enabled() bool { return c.Addr != "" }

// Send delivers one message.
func Send(cfg Config, to, subject, body string) error {
	if cfg.Addr == "" {
		return fmt.Errorf("smtp not configured")
	}
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s",
		cfg.From, to, subject, body)

	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		host = cfg.Addr
		port = ""
	}
	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, host)
	}

	// Port 465 is SMTPS: the whole connection is TLS from the first byte,
	// which net/smtp.SendMail can't speak.
	if port == "465" {
		return sendImplicitTLS(cfg.Addr, host, auth, cfg.From, to, msg)
	}
	// SendMail upgrades via STARTTLS when the server advertises it; PlainAuth
	// refuses to send credentials over unencrypted connections (except to
	// localhost), so misconfigurations fail instead of leaking the password.
	return smtp.SendMail(cfg.Addr, auth, cfg.From, []string{to}, []byte(msg))
}

func sendImplicitTLS(addr, host string, auth smtp.Auth, from, to, msg string) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return fmt.Errorf("smtps dial: %w", err)
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtps client: %w", err)
	}
	defer c.Close()
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// Redacted renders the config for logs/UI without the password.
func (c Config) Redacted() string {
	if c.Username == "" {
		return c.Addr
	}
	return strings.TrimSpace(c.Username) + "@" + c.Addr
}
