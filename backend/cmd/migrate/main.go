// Command migrate applies all pending SQL migrations and exits.
// Runs as a one-shot compose service before api/worker start.
package main

import (
	"errors"
	"log/slog"
	"os"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	dbURL := os.Getenv("TASKHAT_DB_URL")
	if dbURL == "" {
		log.Error("TASKHAT_DB_URL is required")
		os.Exit(1)
	}
	src := os.Getenv("TASKHAT_MIGRATIONS")
	if src == "" {
		src = "file:///migrations"
	}

	m, err := migrate.New(src, dbURL)
	if err != nil {
		log.Error("init migrate", "error", err)
		os.Exit(1)
	}
	err = m.Up()
	if errors.Is(err, migrate.ErrNoChange) {
		log.Info("migrations: no change")
		return
	}
	if err != nil {
		log.Error("apply migrations", "error", err)
		os.Exit(1)
	}
	version, dirty, _ := m.Version()
	log.Info("migrations applied", "version", version, "dirty", dirty)
}
