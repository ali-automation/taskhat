# 08 — Development Guide

## Repository layout (monorepo)

```
taskhat/
├── documentation/           # you are here
├── backend/                 # single Go module
│   ├── cmd/api/             # api entrypoint
│   ├── cmd/worker/          # worker entrypoint
│   ├── internal/            # http, service, store, events, realtime, auth, jiraimport
│   ├── migrations/          # golang-migrate SQL files
│   ├── queries/             # sqlc source .sql
│   └── sqlc.yaml
├── frontend/                # Vite + React + TS
│   └── src/{api,components,pages,hooks,stores}
├── deploy/
│   ├── caddy/Caddyfile
│   └── (env templates)
├── docker-compose.yml       # base: postgres redis rabbitmq minio api worker web caddy
├── docker-compose.override.yml # dev overrides (auto-loaded): exposed ports, mailhog
├── docker-compose.prod.yml
├── Makefile
└── .env.example
```

## Everyday commands (Makefile)

```
make up          # docker compose (base+dev) up --build -d
make down        # stop everything
make logs        # follow api+worker logs
make migrate     # run migrations
make new-migration name=add_x
make sqlc        # regenerate store code from queries/
make test        # go test ./... (unit)
make test-int    # integration tests (testcontainers)
make e2e         # playwright against compose stack
make lint        # golangci-lint + eslint + tsc --noEmit
make seed        # demo data: 2 projects, 50 issues, sprints
```

Dev URLs: app `http://localhost:8080` (caddy), api direct `:8081`, Vite `:5173` (proxied), RabbitMQ mgmt `:15672`, MailHog `:8025`, MinIO console `:9001`.

## Configuration

Env vars only; `.env.example` documents all of them (`TASKHAT_DB_URL`, `TASKHAT_REDIS_URL`, `TASKHAT_AMQP_URL`, `TASKHAT_JWT_SECRET`, `TASKHAT_BASE_URL`, `TASKHAT_STORAGE_*`). Compose injects them; no config files.

## Testing strategy (per stage gates)

| Layer | Tool | What |
|---|---|---|
| Unit (Go) | `testing` | services with store mocks; TQL parser; rank math; ADF converter |
| Integration (Go) | testcontainers-go | store against real Postgres; events against real RabbitMQ; full HTTP handler tests |
| Unit (web) | Vitest + RTL | components, hooks, optimistic-update logic |
| E2E | Playwright | stage parity scenarios (login→create project→create issue→drag on board→…) run against the compose stack |
| Parity review | manual, scripted | side-by-side with real Jira, checklist per stage in `documentation/parity/` |

Rule: a stage is done only when its Playwright scenario passes in CI-mode compose (`make e2e`) and the parity checklist is filled in.

## Conventions

- Go: golangci-lint defaults; errors wrapped with `%w`; context on every service/store call; no global state.
- SQL: every query in `queries/*.sql` with sqlc annotations; migrations never edited after merge — new migration instead.
- TS: strict mode; API types generated per endpoint in `src/api/types.ts` (hand-written first, OpenAPI-generated later if worthwhile).
- Git: trunk-based, small PRs per roadmap checklist item; conventional commits (`feat:`, `fix:`, `docs:`…).
- Domain events are the only trigger for notifications/realtime/history side effects — never call those directly from handlers.
