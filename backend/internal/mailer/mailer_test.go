package mailer

import (
	"bufio"
	"encoding/base64"
	"net"
	"strings"
	"testing"
)

// fakeSMTP speaks just enough SMTP to accept one authenticated message.
// PlainAuth allows plaintext credentials to localhost, so no TLS needed.
func fakeSMTP(t *testing.T, wantAuth bool) (addr string, got chan string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	got = make(chan string, 4)
	go func() {
		defer ln.Close()
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		say := func(s string) { conn.Write([]byte(s + "\r\n")) }
		say("220 fake ESMTP")
		inData := false
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")
			if inData {
				if line == "." {
					inData = false
					say("250 OK")
				}
				continue
			}
			switch {
			case strings.HasPrefix(line, "EHLO"), strings.HasPrefix(line, "HELO"):
				if wantAuth {
					say("250-fake")
					say("250 AUTH PLAIN LOGIN")
				} else {
					say("250 fake")
				}
			case strings.HasPrefix(line, "AUTH PLAIN "):
				raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(line, "AUTH PLAIN "))
				got <- "auth:" + strings.ReplaceAll(string(raw), "\x00", "|")
				say("235 ok")
			case strings.HasPrefix(line, "MAIL FROM:"):
				got <- line
				say("250 ok")
			case strings.HasPrefix(line, "RCPT TO:"):
				got <- line
				say("250 ok")
			case line == "DATA":
				inData = true
				say("354 go")
			case line == "QUIT":
				say("221 bye")
				return
			default:
				say("250 ok")
			}
		}
	}()
	return ln.Addr().String(), got
}

func TestSendWithAuth(t *testing.T) {
	addr, got := fakeSMTP(t, true)
	cfg := Config{Addr: addr, From: "taskhat@example.com", Username: "mailer", Password: "s3cret"}
	if err := Send(cfg, "user@example.com", "hi", "body"); err != nil {
		t.Fatalf("send: %v", err)
	}
	auth := <-got
	if auth != "auth:|mailer|s3cret" {
		t.Fatalf("wrong AUTH PLAIN payload: %q", auth)
	}
	if from := <-got; !strings.Contains(from, "taskhat@example.com") {
		t.Fatalf("wrong MAIL FROM: %q", from)
	}
}

func TestSendWithoutAuth(t *testing.T) {
	addr, got := fakeSMTP(t, false)
	cfg := Config{Addr: addr, From: "taskhat@example.com"}
	if err := Send(cfg, "user@example.com", "hi", "body"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if from := <-got; !strings.HasPrefix(from, "MAIL FROM:") {
		t.Fatalf("expected MAIL FROM first, got %q", from)
	}
}

func TestSendUnconfigured(t *testing.T) {
	if err := Send(Config{}, "user@example.com", "hi", "body"); err == nil {
		t.Fatal("expected error for empty addr")
	}
}
