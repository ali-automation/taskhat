# 02 — Tech Stack

## Recommended stack (proposal)

### Backend — Go

| Concern | Choice | Why |
|---|---|---|
| Language | Go 1.23+ | Requested; great for long-running services, single static binary per service |
| HTTP router | **chi** (`go-chi/chi`) | Idiomatic net/http, middleware-friendly, no framework lock-in. (Alternative: Gin — heavier, faster to prototype; echo — similar. chi keeps us close to stdlib.) |
| DB access | **sqlc** + `pgx/v5` | Type-safe generated code from real SQL. We keep full control of queries (needed for ranking, TQL search). Avoids ORM impedance (GORM rejected: magic, weak for complex queries). |
| Migrations | **golang-migrate** | Standard, works in Docker entrypoint and CI |
| Auth | JWT access + rotating refresh tokens; **argon2id** password hashing | Sessions cached in Redis for revocation |
| Realtime | WebSocket (`coder/websocket`) + Redis pub/sub | Live board updates, issue view refresh — Jira does this too |
| Async jobs | **RabbitMQ** (`amqp091-go`) + dedicated `worker` service | Notifications, Jira import processing, attachment thumbnailing, webhooks |
| Validation | `go-playground/validator` | Standard |
| Logging | `log/slog` (stdlib) | Structured JSON logs |
| Config | env vars only (`caarlos0/env`) | 12-factor, Docker-native |
| Testing | stdlib `testing` + `testcontainers-go` | Integration tests against real Postgres/Redis/RabbitMQ |

### Frontend — React

| Concern | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript + Vite** | Requested; Vite for fast dev & simple static build |
| UI components | **Atlaskit** (`@atlaskit/*`) | Atlassian's own open-source design system — buttons, modals, selects, tags, avatars, page layout, navigation **identical to Jira's**. This is the single biggest lever for UI parity. |
| Drag & drop | **@atlaskit/pragmatic-drag-and-drop** | The exact library Jira uses for its boards and backlog ranking |
| Server state | **TanStack Query v5** | Caching, optimistic updates (crucial for snappy board drag & drop) |
| Client state | Zustand (small slices only) | Most state is server state; avoid Redux ceremony |
| Routing | React Router v7 | Jira-like URLs: `/browse/TH-123`, `/projects/TH/boards/1` |
| Rich text | **TipTap** (ProseMirror) | Jira's editor is ProseMirror-based; TipTap gets us close, and can render Jira's ADF-ish content |
| Forms | @atlaskit/form + react-hook-form where needed | |
| Testing | Vitest + React Testing Library + **Playwright** (E2E) | Playwright drives parity-scenario scripts each stage |

### Infrastructure

| Concern | Choice | Why |
|---|---|---|
| Database | **PostgreSQL 16** | Relational fits issue tracking perfectly; FTS (`tsvector`) covers search until/if we need Meilisearch |
| Cache / sessions / pubsub | **Redis 7** | Session revocation, hot caches (boards, sprints), WebSocket fan-out |
| Message broker | **RabbitMQ 3.13** | Durable async jobs with retries + DLQ (notifications, imports, webhooks) |
| Object storage | Local volume first; **MinIO** (S3 API) from Stage 4 | Attachments; S3-compatible keeps a cloud path open |
| Reverse proxy | **Caddy** (or nginx) | One origin for SPA + API + WebSocket; automatic TLS if ever public |
| Orchestration | **Docker Compose** (dev + prod profiles) | Requested; multi-stage Dockerfiles for slim images |
| CI | GitHub Actions (lint, test, build images) | When repo is pushed |

## Service topology

```
web (React SPA, static)     ─┐
                             ├── caddy (reverse proxy :80)
api (Go, REST + WebSocket)  ─┘
worker (Go, RabbitMQ consumers)
postgres / redis / rabbitmq / minio (Stage 4+)
```

`api` and `worker` are the same Go module (single repo, `cmd/api`, `cmd/worker`) sharing internal packages.

## Alternatives considered

- **Gin instead of chi** — fine choice, slightly faster to write; chi preferred for stdlib compatibility and middleware ecosystem. Easy to swap early if preferred.
- **GORM instead of sqlc** — faster CRUD scaffolding but painful for ranked backlogs, TQL, and reporting queries. Rejected.
- **Custom Tailwind UI instead of Atlaskit** — full visual control, but we would spend weeks re-cloning Jira components Atlassian already publishes. Atlaskit chosen; Tailwind can still style custom areas.
- **Kafka instead of RabbitMQ** — overkill; we need work queues with ack/retry, not a log.
- **Elasticsearch/Meilisearch now** — deferred; Postgres FTS is enough until search parity stage shows gaps.
- **Next.js instead of Vite SPA** — no SEO need for an internal tool; SPA + Caddy is simpler in Docker.

## Decision needed before coding starts

1. **Atlaskit vs custom UI** — recommendation: Atlaskit.
2. **chi vs Gin** — recommendation: chi.
3. Everything else is low-risk and swappable early.
