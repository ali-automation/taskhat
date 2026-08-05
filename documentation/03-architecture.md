# 03 — Architecture

## System diagram

```
                        ┌─────────────────────────────┐
        browser ──────► │  caddy  :80                 │
                        │  /            → web (SPA)   │
                        │  /api/*       → api         │
                        │  /ws          → api (WS)    │
                        │  /attachments → minio*      │
                        └───────┬─────────────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
        ┌──────────┐      ┌──────────┐      ┌───────────┐
        │   web    │      │   api    │◄────►│   redis   │  cache, sessions,
        │ (static) │      │   (Go)   │      └───────────┘  ws pub/sub
        └──────────┘      └───┬──┬───┘
                              │  │ publish jobs
                              │  ▼
                              │ ┌──────────┐     ┌──────────┐
                              │ │ rabbitmq │◄───►│  worker  │
                              │ └──────────┘     │   (Go)   │
                              ▼                  └────┬─────┘
                        ┌──────────┐                  │
                        │ postgres │◄─────────────────┘
                        └──────────┘        (*minio from Stage 4)
```

## Services

### `api` (Go)
- REST API under `/api/v1` (see [05-api-design.md](05-api-design.md)).
- WebSocket endpoint `/ws` — clients subscribe to channels (`board:{id}`, `issue:{key}`, `user:{id}`); events fan out via Redis pub/sub so multiple api replicas stay consistent.
- Stateless — all state in Postgres/Redis; horizontally scalable.
- Publishes domain events to RabbitMQ (`issue.created`, `issue.transitioned`, `comment.added`, `import.requested`, …).

### `worker` (Go)
- Consumes RabbitMQ queues:
  - `notifications` — email/in-app notification fan-out to watchers & assignees
  - `imports` — Jira import jobs (long-running, chunked, resumable)
  - `attachments` — thumbnail/preview generation
  - `webhooks` — outbound webhook delivery with retries
- Each queue has a dead-letter queue; failed jobs are visible and re-runnable.

### `web` (React SPA)
- Built with Vite → static assets served by Caddy (its own tiny nginx/caddy image in dev).
- Talks only to `/api/v1` and `/ws` — same-origin, no CORS in production.

## Layered backend design

```
cmd/api, cmd/worker          → wiring & startup only
internal/http                → handlers, middleware, request/response DTOs
internal/service             → business logic (transitions, ranking, permissions)
internal/store               → sqlc-generated queries + repositories
internal/events              → RabbitMQ publish/consume, event types
internal/realtime            → WebSocket hub + Redis pub/sub bridge
internal/auth                → JWT, argon2id, session revocation
internal/jiraimport          → Jira export parsing & mapping (Stage 6)
```

Rules:
- handlers never touch the DB directly; services never write HTTP.
- Every state-changing service method emits a domain event (drives realtime + notifications + activity log from one source of truth).

## Key mechanics

### Issue ranking (backlog & board order)
Jira uses LexoRank. We use the same idea: a lexicographically ordered string column `rank` with midpoint insertion, so drag-and-drop reorders write **one row**, no mass renumbering. Periodic rebalance job in `worker` when ranks get too long.

### Workflow engine
Statuses and transitions are data, not code: `workflow(id) → status(id, category) → transition(from, to, name)`. Default workflow mirrors Jira's (`To Do → In Progress → Done`, all-to-all initially). Per-project workflows editable in later stage.

### Activity / history
Every mutation writes an `issue_event` row (field, old value, new value, actor, timestamp) inside the same transaction — this powers the History tab and is the source for the notifications worker.

### Realtime updates
Mutation commits → domain event → (a) RabbitMQ for async work, (b) Redis pub/sub → WebSocket hub → connected boards/issue views patch their TanStack Query caches. Matches Jira's live-updating boards.

## Docker layout

- Multi-stage Dockerfiles: Go builds → `FROM scratch`/distroless; web builds → static files in Caddy image.
- `docker-compose.yml` (base) + `docker-compose.override.yml` (auto-loaded dev overrides: exposed ports, MailHog). Production runs `docker compose -f docker-compose.yml up -d` to exclude them.
- Postgres migrations run by a one-shot `migrate` service before `api` starts (compose `depends_on: condition: service_completed_successfully`).
- Healthchecks on every service; `api` waits for postgres/redis/rabbitmq healthy.
