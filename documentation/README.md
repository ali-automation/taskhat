# TaskHat Documentation

TaskHat is a self-hosted project & issue tracker modeled closely on Jira — in both UI and functionality — built with Go and React, fully dockerized.

## Index

| Doc | Contents |
|-----|----------|
| [01-overview.md](01-overview.md) | Vision, goals, non-goals, what "Jira parity" means |
| [02-tech-stack.md](02-tech-stack.md) | Proposed stack, rationale, alternatives considered |
| [03-architecture.md](03-architecture.md) | System architecture, services, Docker topology |
| [04-data-model.md](04-data-model.md) | Core entities and PostgreSQL schema design |
| [05-api-design.md](05-api-design.md) | REST API conventions (modeled on Jira REST API v3) |
| [06-roadmap.md](06-roadmap.md) | TaskHat (Jira-style tracker) staged roadmap — shipped stages 0–19 + planned 20–25 |
| [09-roadmap-dochat.md](09-roadmap-dochat.md) | DocHat (Confluence-style wiki) staged roadmap — shipped W1–W7 + planned W8–W15 |
| [07-jira-import-export.md](07-jira-import-export.md) | Importing real Jira data into TaskHat |
| [08-development-guide.md](08-development-guide.md) | Repo layout, running locally, testing strategy |
| [10-deployment-helm.md](10-deployment-helm.md) | Kubernetes deployment via the Helm chart in `deploy/helm/taskhat` |

## Quick facts

- **Backend:** Go (chi router, sqlc, golang-migrate)
- **Frontend:** React + TypeScript + Vite, Atlaskit (Atlassian's own open-source design system)
- **Infra:** PostgreSQL, Redis, RabbitMQ — all via Docker Compose
- **API style:** REST, deliberately shaped like Jira REST API v3 (eases import/export and client familiarity)
- **Delivery:** staged (see roadmap); every stage ends with a Jira-parity checklist review
