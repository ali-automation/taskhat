# TaskHat Helm chart

Deploys the full TaskHat + DocHat stack on Kubernetes: `api` (Go, port 8081),
`worker`, `web` (nginx + SPA), with bundled PostgreSQL 16, Redis 7 and
RabbitMQ 3.13 — each replaceable by an external service. Database migrations
run as an init container on the api pods (same ordering the compose stack
uses), so upgrades apply schema changes before the new api starts.

## 1. Build and push the images

The backend Dockerfile is multi-target; the chart expects four images:

```sh
REG=registry.example.com/syshat TAG=1.0.0
docker build -t $REG/taskhat-api:$TAG     --target api     backend/
docker build -t $REG/taskhat-worker:$TAG  --target worker  backend/
docker build -t $REG/taskhat-migrate:$TAG --target migrate backend/
docker build -t $REG/taskhat-web:$TAG                      frontend/
docker push $REG/taskhat-api:$TAG $REG/taskhat-worker:$TAG \
            $REG/taskhat-migrate:$TAG $REG/taskhat-web:$TAG
```

## 2. Minimal values

```yaml
# my-values.yaml
image:
  registry: registry.example.com/syshat
  api:     { tag: "1.0.0" }
  worker:  { tag: "1.0.0" }
  migrate: { tag: "1.0.0" }
  web:     { tag: "1.0.0" }

config:
  baseUrl: https://taskhat.example.com   # used in emails and invite links

auth:
  jwtSecret: "<32+ random characters>"

postgresql:
  auth:
    password: "<random>"
rabbitmq:
  auth:
    password: "<random>"

ingress:
  className: nginx
  host: taskhat.example.com
  tls:
    - secretName: taskhat-tls
      hosts: [taskhat.example.com]

# Recommended for production — otherwise attachments live on a PVC that
# must be ReadWriteMany once api/worker scale past one replica.
s3:
  enabled: true
  endpointUrl: https://fsn1.your-objectstorage.com
  region: fsn1
  bucket: my-bucket
  accessKeyId: "<key>"
  secretAccessKey: "<secret>"
```

```sh
helm install taskhat deploy/helm/taskhat -f my-values.yaml -n taskhat --create-namespace
```

## First run

Registration starts open and **the first account registered becomes the
site admin**. Register yours right after install, then flip the site to
invite-only under Admin settings → General configuration.

## Routing

The Ingress reproduces the compose Caddyfile: `/api` and `/ws` (websockets —
live boards, whiteboard collab) go to the api service, everything else to the
SPA. ingress-nginx upgrades websockets out of the box; other controllers may
need their own annotation (e.g. Traefik works as-is, HAProxy needs
`haproxy.org/websocket-services`).

## Secrets

By default the chart renders one Secret with `jwt-secret`, `db-url`,
`redis-url`, `amqp-url` and (when enabled) `postgres-password`,
`rabbitmq-password`, `s3-access-key-id`, `s3-secret-access-key`. To manage
credentials yourself (SealedSecrets, ESO, …), create a Secret carrying those
same keys and set `auth.existingSecret` — the chart then renders none of its
own and every `required` password check is skipped.

## External services

| Bundled | Turn off with | Then set |
|---|---|---|
| PostgreSQL | `postgresql.enabled=false` | `externalDatabase.url` (full `postgres://…` URL) |
| Redis | `redis.enabled=false` | `externalRedis.url` |
| RabbitMQ | `rabbitmq.enabled=false` | `externalAmqp.url` |

## Environment variables

Any backend variable (see `backend/internal/config/config.go` for the full
list) can be set directly — no template changes needed:

```yaml
env:                       # plain vars, inline in the pod spec
  TASKHAT_BASE_URL: https://taskhat.example.com
secrets:                   # secret vars → Kubernetes Secret + envFrom
  TASKHAT_DB_URL: postgres://user:pass@db:5432/taskhat
envFrom:                   # pull in whole external Secrets/ConfigMaps
  - secretRef: {name: my-extra-secret}
```

`secrets:` takes the same NAME: value shape but is stored in a Kubernetes
Secret (`<release>-env`) loaded via envFrom — put credentials there,
typically from a SOPS-encrypted values file. All three apply to api, worker
and the migrate initContainer. Precedence: `env:` > `secrets:` >
chart-derived values (a name in either map suppresses the chart's generated
entry for it). The `config.*` / `s3.*` blocks remain as typed conveniences —
use whichever style you prefer.

## Notable values

| Value | Default | Meaning |
|---|---|---|
| `config.baseUrl` | `http://taskhat.local` | public URL, used in emails/invites |
| `config.smtpAddr` / `smtpFrom` | `""` / `taskhat@localhost` | outgoing mail — `host:587` STARTTLS, `host:465` implicit TLS (DB settings override) |
| `config.smtpUsername` / `smtpPassword` | `""` | SMTP AUTH; password stored in the chart Secret |
| `migrations.enabled` | `true` | run migrations as api initContainer |
| `attachments.persistence.*` | RWO 10Gi PVC | file fallback when `s3.enabled=false` |
| `api.replicas` etc. | `1` | scale freely once S3 (or RWX) is on |
| `mailhog.enabled` | `false` | dev SMTP catcher (`…-mailhog:1025`) |
| `serviceAccount.create` | `true` | |

Lint/render locally (no cluster needed):

```sh
make helm-lint
make helm-template
```
