# 04 — Data Model

PostgreSQL 16. All tables have `id UUID PK DEFAULT gen_random_uuid()`, `created_at`, `updated_at` unless noted. Names below are illustrative; exact DDL lives in `migrations/`.

## Entity overview

```
users ──< project_members >── projects ──< boards ──< board_columns
                                 │            └──< sprints
                                 ├──< issues ──< comments
                                 │       ├──< attachments
                                 │       ├──< issue_events (history)
                                 │       ├──< issue_links
                                 │       ├──< watchers
                                 │       └──< issue_labels >── labels
                                 ├──< components
                                 └──── workflows ──< statuses ──< transitions
```

## Core tables

### users
| column | type | notes |
|---|---|---|
| email | citext unique | login |
| password_hash | text | argon2id |
| display_name | text | |
| avatar_url | text null | |
| is_active | bool | soft-deactivate, never delete (history integrity) |

### projects
| column | type | notes |
|---|---|---|
| key | text unique | e.g. `TH`; uppercase, immutable |
| name | text | |
| description | text | |
| lead_id | fk users | project lead |
| issue_seq | bigint | per-project counter → `TH-{issue_seq}` |
| workflow_id | fk workflows | |
| project_type | enum | `kanban` \| `scrum` |

Issue keys: allocated with `UPDATE projects SET issue_seq = issue_seq + 1 ... RETURNING` inside the insert transaction — gapless enough, race-free.

### issues
| column | type | notes |
|---|---|---|
| project_id | fk | |
| number | int | `key = project.key || '-' || number`; unique (project_id, number) |
| type | enum | `epic` `story` `task` `bug` `subtask` |
| parent_id | fk issues null | subtask→parent, story/task/bug→epic |
| summary | text | |
| description | jsonb | rich-text doc (TipTap JSON, ADF-convertible) |
| status_id | fk statuses | |
| priority | enum | `highest` `high` `medium` `low` `lowest` |
| assignee_id / reporter_id | fk users (assignee null) | |
| story_points | numeric null | |
| sprint_id | fk sprints null | |
| rank | text collate "C" | LexoRank-style ordering |
| due_date | date null | |
| resolution | enum null | `done` `wont_do` `duplicate` `cannot_reproduce` |
| resolved_at | timestamptz null | |
| original_estimate / time_spent | interval null | time tracking (later stage) |
| search_tsv | tsvector generated | FTS over summary + description text |
| jira_id / jira_key | text null | provenance for imported issues (Stage 6) |

Indexes: `(project_id, status_id)`, `(sprint_id)`, `(rank)`, GIN on `search_tsv`, `(assignee_id) where resolution is null`.

### workflows / statuses / transitions
- `workflows(id, name, is_default, updated_at)` — updated_at (migration 0044) is the
  admin directory’s "last edited" stamp
- `statuses(id, workflow_id, name, category enum[todo,in_progress,done], position,
  pos_x, pos_y)` — pos_x/pos_y (migration 0043) are the workflow-editor diagram
  coordinates, NULL = auto-layout
- `transitions(id, workflow_id, from_status_id null=any, to_status_id, name)`
- `transition_rules(id, transition_id, kind enum[restrict-who,required-field,
  auto-assign], config jsonb)` — Stage 26 workflow rules, enforced on every
  status move

### boards / board_columns / sprints
- `boards(id, project_id, name, type enum[kanban,scrum])`
- `board_columns(id, board_id, name, position, min_issues null, max_issues null)` + `board_column_statuses(column_id, status_id)` — Jira maps N statuses per column
- `sprints(id, board_id, name, goal, state enum[future,active,closed], start_at, end_at, completed_at)`

### comments
`(issue_id, author_id, body jsonb, edited_at null)` — soft delete flag; body is same rich-text format as descriptions.

### issue_events (history / activity)
`(issue_id, actor_id, field text, old_value jsonb, new_value jsonb, created_at)` — written in the same tx as the mutation. `field='created'`, `'status'`, `'assignee'`, `'comment'`, etc.

### attachments
`(issue_id, uploader_id, filename, mime, size_bytes, storage_key, thumbnail_key null)` — bytes in volume/MinIO, never in Postgres.

### issue_links
`(source_id, target_id, link_type enum[blocks,is_blocked_by,relates_to,duplicates,is_duplicated_by])` — stored one direction, rendered both.

### labels / issue_labels, components / issue_components
Labels are global per project (`(project_id, name)` unique); components have optional default assignee, like Jira.

### watchers
`(issue_id, user_id)` — reporter auto-watches; drives notifications.

### notifications
`(user_id, issue_id, kind, actor_id, read_at null, payload jsonb)` — in-app notification feed; email delivery handled by worker.

### project_members
`(project_id, user_id, role enum[admin,member,viewer])` — simple RBAC first; scheme-based permissions are a later stage if ever.

## Import provenance (Stage 6)
`import_jobs(id, project_id, source enum[jira_cloud_api,jira_csv,jira_json], status, stats jsonb, error text)` plus `jira_id/jira_key` columns on issues, comments, attachments, users (`jira_account_id`) so re-runs are idempotent (upsert on jira_id).

## Stage 7 additions

### users (new columns)
`public_name, job_title, department, organization, location, timezone, theme` (text),
`avatar_key, header_key` (blob-storage keys; `avatar_url` is derived: `/api/v1/avatars/{avatar_key}`),
plus `jira_account_id` (Stage 6) and `is_admin` (arrives Stage 9).

### sessions
| column | type | notes |
|---|---|---|
| id | uuid PK | referenced by the Redis refresh token entry |
| user_id | fk users | |
| ip | text | from X-Forwarded-For via chi RealIP |
| user_agent | text | raw UA; parsed client-side for display |
| created_at / last_seen_at | timestamptz | last_seen bumped on refresh |
| revoked_at | timestamptz null | set on logout/revoke |

Refresh flow: Redis `refresh:{token}` → `{userID, sessionID}` (30d TTL) and
`session:{sessionID}` → current token (reverse index for revocation). Revoking a session
deletes both keys and stamps `revoked_at`; outstanding access JWTs stay valid ≤15 min.

## Stage 9 additions

### users
`is_admin boolean` — first admin seeded by migration (site owner).

### invites
`(id, email citext, user_id fk-null, token unique, invited_by fk users, created_at,
expires_at, accepted_at null)` — one flow covers new users, claiming imported
placeholder accounts (user_id set), and admin-forced password resets. Accepting sets the
password, activates the account, marks accepted, and logs the user in.

### site_settings
Key/value: `site_name`, `registration_mode` (`open` | `invite-only`), `smtp_addr`,
`smtp_from`. DB values override environment at send/serve time.

## Stage 8 additions

### projects (new columns)
`avatar_key` (blob key → `/api/v1/avatars/{key}`), `default_assignee_id fk-null`
(applied when a work item is created without an assignee), `archived_at timestamptz null`
(archived spaces are hidden from the space list and excluded from search; direct URLs
still work and show a banner), `notify_prefs jsonb` (`{created,transitioned,updated,
comment} → bool`, default all true — gates outgoing email per event type).

### workflows (behavior change)
Migration 0010 clones the shared default workflow into a **per-project workflow**
(statuses, transitions, board column mappings and issue status references remapped).
The original default workflow remains as the template for new projects.

## Stage 10 additions

### users (new columns)
`language` (default `en`; UI wired for future i18n), `landing_page` (default
`your-work` — where the logo/login lands you), `notify_prefs jsonb` (per-user
notification matrix `{emailEnabled, kinds:{<kind>:{inapp,email}}}`, empty = all on).

## Stage 11 additions

### work_types
Site-wide registry of work item types: `key` (stored in issues.type), `name`,
`glyph` (base icon: epic|story|task|bug|subtask), `color`, `is_enabled`, `builtin`,
`position`. The five built-ins are seeded (not deletable; task not disableable).
The old CHECK constraint on issues.type is dropped — validation goes through the
registry.

### custom_fields / issue_field_values
`custom_fields(id, project_id null=all spaces, name, type text|number|date|select,
options jsonb, position)`; values in `issue_field_values(issue_id, field_id,
value jsonb)`. Case-insensitive name uniqueness per scope. Values ride along on
every issue payload as `custom`.

### transitions (now enforced)
The Stage-1 transitions table becomes the real workflow: `from_status_id NULL`
means "from any status". The per-space editor creates/deletes rows; issue
transition and board drag are validated against them.

## Stage 12 additions

### audit_log
`(id, actor_id fk-null, action, target, details jsonb, ip, created_at)` — an
append-only trail of sensitive actions, browsable at Admin → System → Audit log.

### space_categories / projects.category_id
Site-wide categories (unique name) assignable to spaces; deleting a category
just detaches it (`ON DELETE SET NULL`).

## Stage 13 additions

### webhooks / webhook_deliveries
`webhooks(id, name, url, secret, events text[], project_id null=all, is_enabled,
created_by)`; `webhook_deliveries(id, webhook_id, event_type, status http-status
0=network-error, error, attempts, summary, created_at)` — pruned to the newest
200 rows per webhook by the dispatcher.

### api_tokens
`(id, user_id, label, token_hash sha256-hex unique, prefix, last_used_at,
created_at)` — the plaintext token is shown once at creation and never stored.
