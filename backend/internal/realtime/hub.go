// Package realtime fans out domain events to WebSocket clients. Events are
// published through Redis pub/sub so every api replica delivers to its own
// connected clients — the same shape Jira uses for live board updates.
package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"github.com/ali-automation/taskhat/backend/internal/auth"
)

const redisPrefix = "rt:"

// Frame is the server→client message shape.
type Frame struct {
	Channel string          `json:"channel"`
	Event   string          `json:"event"`
	Data    json.RawMessage `json:"data"`
}

type clientMessage struct {
	Type    string          `json:"type"` // auth | subscribe | unsubscribe | publish
	Token   string          `json:"token,omitempty"`
	Channel string          `json:"channel,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type client struct {
	conn     *websocket.Conn
	send     chan []byte
	channels map[string]bool
	userID   string
	mu       sync.Mutex
}

type Hub struct {
	rdb *redis.Client
	log *slog.Logger

	mu   sync.RWMutex
	subs map[string]map[*client]bool
}

func NewHub(rdb *redis.Client, log *slog.Logger) *Hub {
	return &Hub{rdb: rdb, log: log, subs: map[string]map[*client]bool{}}
}

// Publish sends an event to every client subscribed to channel, across all
// api replicas, via Redis.
func (h *Hub) Publish(ctx context.Context, channel, event string, data any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal ws data: %w", err)
	}
	frame, err := json.Marshal(Frame{Channel: channel, Event: event, Data: raw})
	if err != nil {
		return fmt.Errorf("marshal ws frame: %w", err)
	}
	return h.rdb.Publish(ctx, redisPrefix+channel, frame).Err()
}

// Run subscribes to the Redis firehose and routes frames to local clients.
// Blocks until ctx is done.
func (h *Hub) Run(ctx context.Context) error {
	pubsub := h.rdb.PSubscribe(ctx, redisPrefix+"*")
	defer pubsub.Close()
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return fmt.Errorf("redis pubsub closed")
			}
			channel := strings.TrimPrefix(msg.Channel, redisPrefix)
			h.mu.RLock()
			for c := range h.subs[channel] {
				select {
				case c.send <- []byte(msg.Payload):
				default: // slow client: drop frame rather than block the hub
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) subscribe(c *client, channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[channel] == nil {
		h.subs[channel] = map[*client]bool{}
	}
	h.subs[channel][c] = true
	c.channels[channel] = true
}

func (h *Hub) unsubscribe(c *client, channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subs[channel], c)
	if len(h.subs[channel]) == 0 {
		delete(h.subs, channel)
	}
	delete(c.channels, channel)
}

func (h *Hub) drop(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for channel := range c.channels {
		delete(h.subs[channel], c)
		if len(h.subs[channel]) == 0 {
			delete(h.subs, channel)
		}
	}
	close(c.send)
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	// Same-origin is enforced by the reverse proxy; the API itself is not
	// exposed cross-origin in production.
	CheckOrigin: func(r *http.Request) bool { return true },
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 45 * time.Second
	authWait   = 5 * time.Second
)

// HandleWS upgrades the connection. The first client message must be an auth
// frame with a valid access token; then subscribe/unsubscribe messages manage
// channel membership.
func (h *Hub) HandleWS(jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := &client{conn: conn, send: make(chan []byte, 32), channels: map[string]bool{}}

		// Auth handshake.
		conn.SetReadDeadline(time.Now().Add(authWait))
		var first clientMessage
		if err := conn.ReadJSON(&first); err != nil || first.Type != "auth" {
			conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "auth required"))
			conn.Close()
			return
		}
		claims, err := auth.ParseAccessToken(jwtSecret, first.Token)
		if err != nil {
			conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "invalid token"))
			conn.Close()
			return
		}
		c.userID = claims.UserID
		conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(pongWait))
			return nil
		})

		go h.writePump(c)
		h.readPump(c)
	}
}

func (h *Hub) readPump(c *client) {
	defer func() {
		h.drop(c)
		c.conn.Close()
	}()
	for {
		var msg clientMessage
		if err := c.conn.ReadJSON(&msg); err != nil {
			return
		}
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		switch msg.Type {
		case "subscribe":
			if msg.Channel != "" {
				h.subscribe(c, msg.Channel)
			}
		case "unsubscribe":
			if msg.Channel != "" {
				h.unsubscribe(c, msg.Channel)
			}
		case "publish":
			// Client-originated fan-out is reserved for live canvas sync.
			if strings.HasPrefix(msg.Channel, "canvas:") && len(msg.Data) > 0 && len(msg.Data) < 512*1024 {
				_ = h.Publish(context.Background(), msg.Channel, "canvas",
					map[string]any{"from": c.userID, "payload": json.RawMessage(msg.Data)})
			}
		}
	}
}

func (h *Hub) writePump(c *client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case frame, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, frame); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
