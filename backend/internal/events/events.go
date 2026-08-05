// Package events defines domain events and the RabbitMQ topology TaskHat uses.
// The api publishes to the topic exchange; workers bind queues per concern.
package events

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const Exchange = "taskhat.events"

type Event struct {
	Type       string          `json:"type"` // e.g. "issue.created"
	ActorID    string          `json:"actorId"`
	OccurredAt time.Time       `json:"occurredAt"`
	Payload    json.RawMessage `json:"payload"`
}

type Publisher struct {
	url  string
	mu   sync.Mutex
	conn *amqp.Connection
	ch   *amqp.Channel
}

func NewPublisher(amqpURL string) (*Publisher, error) {
	p := &Publisher{url: amqpURL}
	if err := p.reconnect(); err != nil {
		return nil, err
	}
	return p, nil
}

// reconnect (re)establishes the connection + channel. Caller holds p.mu
// (or is the constructor).
func (p *Publisher) reconnect() error {
	if p.conn != nil {
		p.conn.Close()
	}
	conn, err := amqp.Dial(p.url)
	if err != nil {
		return fmt.Errorf("connect rabbitmq: %w", err)
	}
	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return fmt.Errorf("open channel: %w", err)
	}
	if err := ch.ExchangeDeclare(Exchange, "topic", true, false, false, false, nil); err != nil {
		conn.Close()
		return fmt.Errorf("declare exchange: %w", err)
	}
	p.conn, p.ch = conn, ch
	return nil
}

// Publish sends the event; if the broker dropped our connection (memory
// pressure, heartbeat loss during heavy builds…) it reconnects and retries
// once so events aren't silently lost.
func (p *Publisher) Publish(ctx context.Context, e Event) error {
	body, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	msg := amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Timestamp:    e.OccurredAt,
		Body:         body,
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn == nil || p.conn.IsClosed() {
		if err := p.reconnect(); err != nil {
			return err
		}
	}
	if err := p.ch.PublishWithContext(ctx, Exchange, e.Type, false, false, msg); err != nil {
		if rerr := p.reconnect(); rerr != nil {
			return fmt.Errorf("%w (reconnect also failed: %v)", err, rerr)
		}
		return p.ch.PublishWithContext(ctx, Exchange, e.Type, false, false, msg)
	}
	return nil
}

// QueueDepths reports message counts for known queues (management view).
func (p *Publisher) QueueDepths(names []string) map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn == nil || p.conn.IsClosed() {
		if err := p.reconnect(); err != nil {
			out := map[string]int{}
			for _, name := range names {
				out[name] = -1
			}
			return out
		}
	}
	depths := map[string]int{}
	for _, name := range names {
		q, err := p.ch.QueueDeclarePassive(name, true, false, false, false, nil)
		if err != nil {
			// A failed passive declare closes the channel; reopen it.
			if ch, cerr := p.conn.Channel(); cerr == nil {
				p.ch = ch
			}
			depths[name] = -1
			continue
		}
		depths[name] = q.Messages
	}
	return depths
}

func (p *Publisher) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ch != nil {
		p.ch.Close()
	}
	if p.conn != nil {
		p.conn.Close()
	}
}

// Consume binds a durable queue to the exchange for the given routing patterns
// and delivers messages to handler until ctx is done. Errors from handler nack
// the message for redelivery.
func Consume(ctx context.Context, amqpURL, queue string, patterns []string, handler func(Event) error) error {
	conn, err := amqp.Dial(amqpURL)
	if err != nil {
		return fmt.Errorf("connect rabbitmq: %w", err)
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	if err := ch.ExchangeDeclare(Exchange, "topic", true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare exchange: %w", err)
	}
	if _, err := ch.QueueDeclare(queue, true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare queue: %w", err)
	}
	for _, p := range patterns {
		if err := ch.QueueBind(queue, p, Exchange, false, nil); err != nil {
			return fmt.Errorf("bind queue: %w", err)
		}
	}
	deliveries, err := ch.Consume(queue, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume: %w", err)
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case d, ok := <-deliveries:
			if !ok {
				return fmt.Errorf("delivery channel closed")
			}
			var e Event
			if err := json.Unmarshal(d.Body, &e); err != nil {
				_ = d.Nack(false, false) // malformed: drop
				continue
			}
			if err := handler(e); err != nil {
				_ = d.Nack(false, true)
				continue
			}
			_ = d.Ack(false)
		}
	}
}
