# 05 — API Design

REST under `/api/v1`, JSON. Deliberately shaped like **Jira REST API v3** — same resource names, similar payload shapes — so that (a) the Jira importer maps nearly 1:1, (b) tools/people that know Jira's API feel at home.

## Conventions

- Auth: `Authorization: Bearer <access JWT>`; refresh via `POST /auth/refresh` (httpOnly cookie).
- Errors: `{ "errors": { "field": "msg" }, "errorMessages": ["..."] }` — Jira's error shape.
- Pagination: `?startAt=0&maxResults=50` → `{ startAt, maxResults, total, isLast, values: [...] }` — Jira's pagination shape.
- Issues addressable by key (`TH-123`) or UUID everywhere.
- Partial updates via `PUT /issues/{key}` with `{ "fields": {...} }` — Jira's edit shape.
- Every mutating endpoint emits a domain event (realtime + history + notifications).

## Endpoints by stage

### Auth & users (Stage 0)
```
POST   /auth/register            POST /auth/login         POST /auth/refresh
POST   /auth/logout              GET  /me
GET    /users?query=             GET  /users/{id}
```

### Projects (Stage 1)
```
GET    /projects                 POST /projects
GET    /projects/{key}           PUT  /projects/{key}      DELETE /projects/{key}
GET    /projects/{key}/members   POST /projects/{key}/members
GET    /projects/{key}/statuses  GET  /projects/{key}/labels
GET    /projects/{key}/components  POST /projects/{key}/components
```

### Issues (Stage 1–2)
```
POST   /issues                          create { fields: { project, issuetype, summary, ... } }
GET    /issues/{key}                    full issue with fields, rendered like Jira's GET /issue
PUT    /issues/{key}                    edit fields
DELETE /issues/{key}
GET    /issues/{key}/transitions        available transitions for current status
POST   /issues/{key}/transitions        { transition: { id } }  — Jira's transition call
PUT    /issues/{key}/rank               { rankBeforeIssue | rankAfterIssue } — drag & drop
POST   /issues/{key}/watchers           DELETE /issues/{key}/watchers/{userId}
GET    /issues/{key}/changelog          history (issue_events)
```

### Comments & attachments (Stage 4)
```
GET/POST /issues/{key}/comments         PUT/DELETE /issues/{key}/comments/{id}
POST     /issues/{key}/attachments      (multipart)   DELETE /attachments/{id}
```

### Boards, backlog, sprints (Stage 2–3)
```
GET    /projects/{key}/boards           GET /boards/{id}
GET    /boards/{id}/columns             PUT /boards/{id}/columns
GET    /boards/{id}/issues              board view (grouped by column)
GET    /boards/{id}/backlog             ranked, unresolved, not in active sprint
GET    /boards/{id}/sprints             POST /boards/{id}/sprints
POST   /sprints/{id}/start              POST /sprints/{id}/complete
POST   /sprints/{id}/issues             move issues into sprint
```

### Search (Stage 5)
```
GET    /search?tql=project = TH AND status = "In Progress" ORDER BY priority DESC
```
TQL grammar (subset of JQL): `field op value` joined by `AND`/`OR`, fields: `project, type, status, assignee, reporter, priority, label, component, sprint, text, created, updated, due`; ops: `= != IN NOT IN ~ > < >= <=`; `ORDER BY field [ASC|DESC]`. Compiles to SQL over indexed columns + FTS for `text ~`.

### Notifications & realtime (Stage 4)
```
GET    /notifications            POST /notifications/read
WS     /ws                       subscribe: {"channel":"board:{id}"} etc.
```

### Import (Stage 6)
```
POST   /import/jira              start job { source: csv|json|api, ... } (multipart for files)
GET    /import/jira/{jobId}      progress + stats + per-item errors
```

## WebSocket events

Server → client messages: `{ "channel": "board:1", "event": "issue.updated", "data": { issue... } }`.
Events: `issue.created|updated|transitioned|ranked|deleted`, `comment.added`, `sprint.started|completed`, `notification.new`.

### Account & people (Stage 7)
```
GET    /account                      profile + preferences
PUT    /account/profile              { displayName, publicName, jobTitle, department, organization, location }
PUT    /account/email                { email, currentPassword }
PUT    /account/password             { currentPassword, newPassword }   → revokes other sessions
PUT    /account/preferences          { timezone, theme }
POST   /account/avatar               multipart "file"      DELETE /account/avatar
POST   /account/header               multipart "file"      DELETE /account/header
GET    /account/sessions             list with current flag
DELETE /account/sessions/{id}        revoke one
DELETE /account/sessions             revoke all except current
GET    /users/{id}/profile           public profile (auth required)
GET    /avatars/{key}                image stream — NO auth; keys are unguessable UUIDs
```

### Admin & invites (Stage 9)
```
GET    /site                          public: { siteName, registrationMode }
GET    /auth/invite/{token}           public: prefill info for the accept page
POST   /auth/accept-invite            public: { token, displayName, password } → logs in

GET    /admin/users?query=            all users incl. deactivated/imported (+isAdmin flags)
POST   /admin/users/{id}/activate     POST /admin/users/{id}/deactivate
POST   /admin/users/{id}/admin        { isAdmin } — cannot demote yourself
POST   /admin/invites                 { email, userId? } — userId claims an imported
                                      placeholder; response includes inviteUrl (copyable)
GET    /admin/invites                 pending invites   DELETE /admin/invites/{id}
GET    /admin/projects                site-wide spaces + counts
PUT    /admin/projects/{key}/lead     { email }         DELETE /admin/projects/{key}
GET    /admin/settings                PUT /admin/settings  { siteName, registrationMode,
                                      smtpAddr, smtpFrom } — SMTP stored in DB, used by
                                      invite emails and worker notifications (env fallback)
GET    /admin/system                  counts + recent import jobs + component health
```
All `/admin/*` routes require the `is_admin` flag. Registration honors
`registrationMode`: `invite-only` rejects self-registration.

### Space settings (Stage 8) — space-admin gated
```
PUT    /projects/{key}                     now also accepts { defaultAssigneeId | null }
POST   /projects/{key}/avatar              multipart    DELETE /projects/{key}/avatar
PUT    /projects/{key}/members/{userId}    { role }     DELETE /projects/{key}/members/{userId}
PUT    /projects/{key}/labels/{name}       { newName } — merges when newName exists
DELETE /projects/{key}/labels/{name}
POST   /projects/{key}/statuses            { name, category } → also appends a board column
PUT    /projects/{key}/statuses/{id}       { name }
DELETE /projects/{key}/statuses/{id}       only when unused; removes its column mapping
POST   /projects/{key}/archive             POST /projects/{key}/unarchive
PUT    /projects/{key}/notifications       { created, transitioned, updated, comment } —
                                           gates *email* only; in-app notifications always fire
PUT    /boards/{id}/columns                now also accepts per-column { position }
```
Since Stage 8 every project owns its **own workflow** (cloned from the default at
creation; existing projects migrated) so status edits never leak across spaces.

### Personal settings (Stage 10)
```
PUT /account/preferences        now { timezone, theme, language, landingPage }
GET /account/notifications      per-user notification preferences
PUT /account/notifications      { emailEnabled, kinds: { created|transitioned|updated|
                                  comment|mention: { inapp, email } } }
```
Missing keys default to true. Worker resolution: **in-app** row + WS frame only if the
user's `inapp` pref allows the kind; **email** only if user kind pref AND user global
`emailEnabled` AND (for non-mention kinds) the space's notify_prefs AND SMTP configured.

### Stage 10 rework additions
`PUT /admin/settings` also accepts `introduction` (shown on the log-in screen) and
`default_language`; public `GET /site` now returns `introduction`.

### Work items admin (Stage 11)
```
GET    /work-types                      enabled types (all users)
GET    /admin/work-types                all types (admin)      POST /admin/work-types
PUT    /admin/work-types/{id}           name/glyph/color/enabled
DELETE /admin/work-types/{id}           custom + unused only

GET    /projects/{key}/fields           applicable custom fields (member)
GET    /admin/fields                    all defs + usage (admin)   POST /admin/fields
PUT    /admin/fields/{id}               name/options            DELETE /admin/fields/{id}

GET    /projects/{key}/transitions      full workflow transition list (member)
POST   /projects/{key}/transitions      { name, fromStatusId|null, toStatusId } (space admin)
DELETE /projects/{key}/transitions/{id}

GET    /projects/{key}/workflow         Stage 26: statuses (with diagram x/y) +
                                        transitions (with rules) + usedIn (member)
PUT    /projects/{key}/workflow         bulk editor commit (space admin): replaces
                                        statuses/transitions/rules in one tx; new
                                        statuses use temp ids referenced by
                                        fromRef/toRef; keeps board columns in sync
```
- Transition rules (Stage 26, enforced by the transition endpoints and board
  drags): `restrict-who {users, roles}` → 403, `required-field {fields}` → 400,
  `auto-assign {assignee: uuid|"actor"|""}` post function.

```
GET    /admin/workflows                 directory: every workflow + spaces using
                                        it + updatedAt (admin)
POST   /admin/workflows                 { name } → inactive workflow seeded from
                                        the default statuses
GET    /admin/workflows/{id}            editor payload (statuses/transitions/
                                        rules + usedIn)
PUT    /admin/workflows/{id}            bulk editor commit; optional name renames
DELETE /admin/workflows/{id}            inactive, non-default only
POST   /admin/workflows/{id}/copy       "Copy of X" (full clone incl. rules)
POST   /admin/workflows/{id}/assign     { projectKey } — clone onto the space,
                                        remap issues by status name, rebuild
                                        board columns, drop the orphaned workflow
```
- `GET /issues/{key}/transitions` now reads the transitions table (from = current
  status or "any"); `POST` **enforces** the workflow — a bare target status id is
  still accepted (board drag) but must be reachable, else 400.
- Issue create/update accept `fields.custom: { <fieldId>: value }`; issues carry
  `custom: { <fieldId>: value }` everywhere.
- TQL: `cf["Field name"] = value | != | ~ | !~ | EMPTY`, and `> < >= <=` for
  number fields.

### System admin (Stage 12)
```
GET  /admin/audit?query=&action=&startAt=      paged audit trail
POST /admin/settings/test-email  { to }        send a test email via current SMTP
GET  /admin/system                             now includes queues: {name: depth}
GET  /admin/categories        POST /admin/categories { name }   DELETE /admin/categories/{id}
PUT  /admin/projects/{key}/category  { id | null }
POST /admin/projects/{key}/unarchive           site-admin unarchive (no membership needed)
```
Security policies live in site_settings and are enforced:
`min_password_len` (register / invite / change), `login_lockout_attempts` +
`login_lockout_minutes` (Redis counters per email; 429 when tripped),
`session_lifetime_days` (refresh-token TTL at issue time),
`create_projects_mode` = everyone ⇄ admins-only (enforced on POST /projects).
New-user defaults (`default_timezone`, `default_language`, `default_landing_page`)
are applied at register and invite-accept. Sensitive actions write to the audit log
(logins incl. failures/lockouts, registration, invites, user admin actions, settings
changes, space create/delete/archive, workflow/type/field changes).

### Integrations (Stage 13)
```
GET  /account/api-tokens         list (label, prefix, created, last used)
POST /account/api-tokens         { label } → full token shown ONCE (tk_…)
DELETE /account/api-tokens/{id}  revoke

GET    /admin/webhooks           POST /admin/webhooks
                                 { name, url, secret?, events[], projectKey|null }
PUT    /admin/webhooks/{id}      name/url/secret/events/scope/isEnabled
DELETE /admin/webhooks/{id}
GET    /admin/webhooks/{id}/deliveries    recent delivery log
```
- API tokens are SHA-256-hashed at rest; `Authorization: Bearer tk_…` works on the
  whole REST API (last-used timestamp updated). Creation/revocation is audited.
- Webhooks fire from the worker (queue `webhooks`): POST JSON
  `{event, timestamp, data}` with `X-TaskHat-Event` and
  `X-TaskHat-Signature: sha256=<hmac-sha256(secret, body)>`; 3 attempts with
  backoff; every delivery logged (status, attempts, error) and pruned to the
  latest 200 per webhook. Event filter: issue.created/updated/transitioned/
  deleted, comment.added, project.created, or `*`; scope: one space or all.
