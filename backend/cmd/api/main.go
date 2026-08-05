package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ali-automation/taskhat/backend/internal/config"
	"github.com/ali-automation/taskhat/backend/internal/events"
	"github.com/ali-automation/taskhat/backend/internal/httpapi"
	"github.com/ali-automation/taskhat/backend/internal/realtime"
	"github.com/ali-automation/taskhat/backend/internal/storage"
	"github.com/ali-automation/taskhat/backend/internal/store"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe the local /health endpoint and exit")
	flag.Parse()

	if *healthcheck {
		os.Exit(runHealthcheck())
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("api exited", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, cfg.DBURL)
	if err != nil {
		return err
	}
	defer st.Close()

	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("ping redis: %w", err)
	}

	// RabbitMQ can lag behind its healthcheck right after a restart — retry.
	var publisher *events.Publisher
	for attempt := 1; ; attempt++ {
		publisher, err = events.NewPublisher(cfg.AMQPURL)
		if err == nil {
			break
		}
		if attempt >= 10 || ctx.Err() != nil {
			return fmt.Errorf("rabbitmq publisher: %w", err)
		}
		log.Warn("rabbitmq not ready, retrying", "attempt", attempt, "error", err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	defer publisher.Close()

	var blobs storage.Blob
	if cfg.S3EndpointURL != "" {
		blobs, err = storage.NewS3(ctx, storage.S3Config{
			EndpointURL: cfg.S3EndpointURL,
			Region:      cfg.S3Region,
			Bucket:      cfg.S3Bucket,
			AccessKey:   cfg.S3AccessKey,
			SecretKey:   cfg.S3SecretKey,
			Prefix:      cfg.S3Prefix,
		})
		if err != nil {
			return fmt.Errorf("s3 storage: %w", err)
		}
		log.Info("attachment storage: s3", "endpoint", cfg.S3EndpointURL, "bucket", cfg.S3Bucket)
	} else {
		blobs, err = storage.NewFS(cfg.StorageDir)
		if err != nil {
			return fmt.Errorf("fs storage: %w", err)
		}
		log.Info("attachment storage: filesystem", "dir", cfg.StorageDir)
	}

	hub := realtime.NewHub(rdb, log)
	go func() {
		if err := hub.Run(ctx); err != nil && ctx.Err() == nil {
			log.Error("realtime hub stopped", "error", err)
		}
	}()

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.NewServer(cfg, st, rdb, publisher, hub, blobs, log).Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", cfg.ListenAddr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return nil
	}
}

func runHealthcheck() int {
	addr := os.Getenv("TASKHAT_LISTEN_ADDR")
	if addr == "" {
		addr = ":8081"
	}
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://localhost" + addr + "/api/v1/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "unhealthy:", resp.Status)
		return 1
	}
	return 0
}
