# 10 — Kubernetes deployment (Helm)

The chart lives at [`deploy/helm/taskhat`](../deploy/helm/taskhat/) — full
usage, values and image-build instructions are in its
[README](../deploy/helm/taskhat/README.md).

## Shape

| Compose service | Kubernetes object |
|---|---|
| `api` | Deployment (+Service :8081), HTTP probes on `/api/v1/health` |
| `migrate` | initContainer on the api pods (golang-migrate advisory lock makes concurrent rollouts safe; works on first install, unlike Helm hooks which would run before the bundled Postgres exists) |
| `worker` | Deployment |
| `web` | Deployment (+Service :80), nginx serving the SPA |
| `caddy` | Ingress — `/api` and `/ws` → api, `/` → web |
| `postgres` / `redis` / `rabbitmq` | Single-replica StatefulSets with PVCs, toggleable (`*.enabled=false` + `external*.url` for managed services) |
| `attachments` volume | Shared PVC when `s3.enabled=false` (RWX needed to scale api/worker), or no volume at all with S3 |
| `mailhog` | Optional dev Deployment (`mailhog.enabled`) |

## Conventions

- One chart-managed Secret holds the JWT secret, connection URLs and
  passwords; `auth.existingSecret` swaps in an externally managed one.
- Required-at-install values fail with helpful messages: `auth.jwtSecret`,
  `postgresql.auth.password`, `rabbitmq.auth.password` (or their external
  URLs when the bundled service is off).
- api/worker run the distroless images as non-root (65532) with a read-only
  root filesystem; a `checksum/secret` pod annotation rolls them when the
  Secret changes.
- `make helm-lint` / `make helm-template` validate the chart offline.

## Per-cluster values

`deploy/helm/taskhat/clusters/<cluster>/` holds the values for each installation —
`taskhat.yaml` (plain `env:` map — images, ingress, service toggles) plus
`taskhat.enc.yaml` (SOPS-encrypted with AWS KMS, your KMS profile;
rule in the chart-level `deploy/helm/taskhat/.sops.yaml`) whose `secrets:` map
carries the secret variables (TASKHAT_JWT_SECRET, TASKHAT_DB_URL,
TASKHAT_AMQP_URL, TASKHAT_SMTP_PASSWORD, S3 keys) — rendered into a
Kubernetes Secret (`<release>-env`) and loaded via envFrom. Plain vars go
in `env:` (inline). Precedence: `env:` > `secrets:` > chart-derived; a
name in either map suppresses the chart's generated entry, and when they
cover everything the chart's classic Secret isn't rendered at all. Start from `deploy/helm/taskhat/examples/values-production.yaml`.

```sh
sops -d deploy/helm/taskhat/clusters/<your-cluster>/taskhat.enc.yaml > /tmp/taskhat-secrets.yaml
helm upgrade --install taskhat deploy/helm/taskhat \
  -f deploy/helm/taskhat/clusters/<your-cluster>/taskhat.yaml -f /tmp/taskhat-secrets.yaml
```

Edit secrets with `sops deploy/helm/taskhat/clusters/<your-cluster>/taskhat.enc.yaml` — never
commit a decrypted copy.

Versioning: chart `version` tracks packaging changes, `appVersion` the
TaskHat image tag default — bump `appVersion` when publishing new images.
