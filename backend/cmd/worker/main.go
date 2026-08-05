package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ali-automation/taskhat/backend/internal/automation"
	"github.com/ali-automation/taskhat/backend/internal/confimport"
	"github.com/ali-automation/taskhat/backend/internal/config"
	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/jiraimport"
	"github.com/ali-automation/taskhat/backend/internal/mailin"
	"github.com/ali-automation/taskhat/backend/internal/notify"
	"github.com/ali-automation/taskhat/backend/internal/realtime"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
	"github.com/ali-automation/taskhat/backend/internal/webhooks"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := connectStore(ctx, cfg, log)
	if err != nil {
		log.Error("store", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Error("redis url", "error", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()
	hub := realtime.NewHub(rdb, log)

	notifier := notify.New(cfg, st, hub, log)

	blobs, err := storage.FromConfig(ctx, cfg.S3EndpointURL, cfg.S3Region, cfg.S3Bucket,
		cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Prefix, cfg.StorageDir)
	if err != nil {
		log.Error("storage", "error", err)
		os.Exit(1)
	}
	importer := &jiraimport.JobRunner{St: st, Blobs: blobs, Hub: hub, Log: log}
	confImporter := &confimport.JobRunner{St: st, Blobs: blobs, Hub: hub, Log: log}

	log.Info("worker starting")
	go runConsumer(ctx, cfg, log, "events.log", []string{"#"}, func(e events.Event) error {
		log.Info("event", "type", e.Type, "actor", e.ActorID)
		return nil
	})
	go runConsumer(ctx, cfg, log, "imports", []string{"import.scan", "import.run"}, func(e events.Event) error {
		var payload struct {
			JobID string `json:"jobId"`
		}
		if err := json.Unmarshal(e.Payload, &payload); err != nil || payload.JobID == "" {
			log.Error("bad import payload", "error", err)
			return nil
		}
		mode := "scan"
		if e.Type == "import.run" {
			mode = "run"
		}
		// Confluence jobs run through their own pipeline.
		if job, err := st.GetImportJob(ctx, payload.JobID); err == nil && job.Source == "confluence_api" {
			return confImporter.Execute(ctx, payload.JobID, mode)
		}
		return importer.Execute(ctx, payload.JobID, mode)
	})
	dispatcher := webhooks.New(st, log)
	go runConsumer(ctx, cfg, log, "webhooks",
		[]string{"issue.#", "comment.#", "project.#", "sprint.#"},
		dispatcher.Handle)

	// Automation: republish engine mutations so notifications/webhooks/live
	// boards see them (attributed to the automation actor).
	autoPublisher, err := connectPublisher(ctx, cfg, log)
	if err != nil {
		log.Error("automation publisher", "error", err)
		os.Exit(1)
	}
	defer autoPublisher.Close()
	engine := automation.New(cfg, st, rdb, autoPublisher, hub, log)
	go runConsumer(ctx, cfg, log, "automation",
		[]string{"issue.#", "comment.#", "project.#", "sprint.#", "automation.#"},
		engine.HandleEvent)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				engine.Tick(ctx)
			}
		}
	}()
	// Incoming mail: poll IMAP handlers once a minute (Jira's mail handler delay).
	mailPoller := mailin.New(st, blobs, autoPublisher, log)
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				mailPoller.PollAll(ctx)
			}
		}
	}()
	runConsumer(ctx, cfg, log, "notifications",
		[]string{"issue.created", "issue.updated", "issue.transitioned", "comment.added",
			"wiki.page_updated", "wiki.comment_added"},
		notifier.Handle)
	log.Info("worker stopped")
}

// connectPublisher retries — rabbitmq may lag on cold start.
func connectPublisher(ctx context.Context, cfg config.Config, log *slog.Logger) (*events.Publisher, error) {
	for attempt := 1; ; attempt++ {
		p, err := events.NewPublisher(cfg.AMQPURL)
		if err == nil {
			return p, nil
		}
		if attempt >= 30 {
			return nil, err
		}
		log.Warn("publisher connect failed, retrying", "attempt", attempt, "error", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// connectStore retries — postgres may lag its healthcheck on cold start.
func connectStore(ctx context.Context, cfg config.Config, log *slog.Logger) (*store.Store, error) {
	for attempt := 1; ; attempt++ {
		st, err := store.New(ctx, cfg.DBURL)
		if err == nil {
			return st, nil
		}
		if attempt >= 10 || ctx.Err() != nil {
			return nil, err
		}
		log.Warn("postgres not ready, retrying", "attempt", attempt)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

func runConsumer(ctx context.Context, cfg config.Config, log *slog.Logger, queue string, patterns []string, handler func(events.Event) error) {
	for {
		err := events.Consume(ctx, cfg.AMQPURL, queue, patterns, handler)
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return
		}
		log.Error("consume loop failed, reconnecting", "queue", queue, "error", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}
