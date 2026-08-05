# docker-compose.override.yml is auto-loaded; no -f flags needed.
COMPOSE := docker compose

.PHONY: up down logs ps build deploy redeploy test test-backend test-frontend lint migrate new-migration sqlc seed

up:
	$(COMPOSE) up --build -d

# Full deploy: rebuild images (incremental via cache mounts), apply
# migrations, recreate changed services, and wait until healthy.
deploy:
	$(COMPOSE) build
	$(COMPOSE) up -d --wait --wait-timeout 180

# Redeploy one service: make redeploy s=api
redeploy:
	@test -n "$(s)" || (echo "usage: make redeploy s=api|worker|web" && exit 1)
	$(COMPOSE) build $(s)
	$(COMPOSE) up -d --wait --wait-timeout 180 $(s)

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f api worker

ps:
	$(COMPOSE) ps

build:
	cd backend && go build ./...
	cd frontend && npm run build

test: test-backend test-frontend

test-backend:
	cd backend && go test ./...

test-frontend:
	cd frontend && npm test -- --run

lint:
	cd backend && go vet ./...
	cd frontend && npx tsc --noEmit

migrate:
	$(COMPOSE) run --rm migrate

new-migration:
	@test -n "$(name)" || (echo "usage: make new-migration name=add_x" && exit 1)
	@n=$$(printf '%04d' $$(( $$(ls backend/migrations | tail -1 | cut -d_ -f1 | sed 's/^0*//' 2>/dev/null || echo 0) + 1 ))); \
	touch backend/migrations/$${n}_$(name).up.sql backend/migrations/$${n}_$(name).down.sql; \
	echo "created backend/migrations/$${n}_$(name).{up,down}.sql"

sqlc:
	cd backend && sqlc generate

# ---- Helm chart (deploy/helm/taskhat) — offline lint/render, no cluster ----
HELM_CHART = deploy/helm/taskhat
HELM_TEST_ARGS = --set auth.jwtSecret=0123456789abcdef0123456789abcdef \
	--set postgresql.auth.password=lint-only --set rabbitmq.auth.password=lint-only

helm-lint:
	helm lint $(HELM_CHART) $(HELM_TEST_ARGS)

helm-template:
	helm template taskhat $(HELM_CHART) $(HELM_TEST_ARGS)

helm-package:
	helm package $(HELM_CHART) -d deploy/helm/dist
