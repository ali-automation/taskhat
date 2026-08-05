FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
# Cache mounts persist the module and build caches across image builds,
# so a code change recompiles incrementally instead of from scratch.
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/taskhat-api ./cmd/api \
 && CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/taskhat-worker ./cmd/worker \
 && CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/taskhat-migrate ./cmd/migrate \
 && mkdir -p /out/attachments

FROM gcr.io/distroless/static-debian12:nonroot AS api
COPY --from=builder /out/taskhat-api /taskhat-api
# Seed the attachments dir with nonroot ownership so the named volume
# inherits it on first use (distroless runs as uid 65532).
COPY --from=builder --chown=nonroot:nonroot /out/attachments /data/attachments
ENTRYPOINT ["/taskhat-api"]

FROM gcr.io/distroless/static-debian12:nonroot AS worker
COPY --from=builder /out/taskhat-worker /taskhat-worker
ENTRYPOINT ["/taskhat-worker"]

FROM gcr.io/distroless/static-debian12:nonroot AS migrate
COPY --from=builder /out/taskhat-migrate /taskhat-migrate
COPY --from=builder /src/migrations /migrations
ENTRYPOINT ["/taskhat-migrate"]
