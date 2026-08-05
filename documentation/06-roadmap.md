# 06 — TaskHat Roadmap (Multistage Plan)

> **This file covers TaskHat (the project-tracking half) only.** DocHat (the Confluence
> twin) has its own staged roadmap in [09-roadmap-dochat.md](09-roadmap-dochat.md).
>
> **Status (2026-07-16): every planned stage — 0–19 including the UI parity
> pass, settings, automation, and Track B — is complete and smoke-tested.**
> The next feature stages below are specced and waiting to be scheduled.

Each stage is independently shippable and ends with two gates:

1. **Test gate** — unit + integration tests green; Playwright E2E for the stage's scenarios.
2. **Jira parity gate** — scripted side-by-side walkthrough vs real Jira; gaps logged as issues (in TaskHat itself, from Stage 1 on — we dogfood).

## Stage 0 — Foundation & skeleton
**Goal: `docker compose up` gives a login screen and an authenticated empty app shell that looks like Jira.**

- Repo layout, Go module, Vite app, multi-stage Dockerfiles, Compose (postgres, redis, rabbitmq, api, worker, web, caddy) with healthchecks + migrations service.
- Auth: register/login/refresh/logout, argon2id, JWT + Redis-revocable sessions.
- App shell with Atlaskit: top navigation, sidebar, page layout matching Jira's chrome.
- CI-ready: `make lint test build`, golangci-lint, vitest.

**Parity check:** login page → app chrome; compare nav/sidebar structure with Jira.

## Stage 1 — Projects & issues (CRUD + issue view)
**Goal: create a project, create/edit issues, browse them in a Jira-like list and issue detail view.**

- Projects CRUD, members, roles; project key + issue key generation.
- Issues CRUD: types, priorities, assignee/reporter, labels, components, description (rich text editor).
- Default workflow (To Do / In Progress / Done) + transitions endpoint.
- Issue detail page following Jira’s familiar layout: summary, description, right-hand fields panel, status dropdown.
- Issue list per project with inline status/assignee edit.
- `/browse/TH-123` routes.

**Parity check:** create-project flow, create-issue modal, issue view layout, transition via status dropdown.

## Stage 2 — Kanban board
**Goal: a live Jira-style Kanban board with drag & drop.**

- Board + columns (statuses mapped to columns, column config UI).
- Board view: cards (key, summary, type icon, priority icon, assignee avatar, points), column WIP limits.
- Drag & drop between/within columns (pragmatic-drag-and-drop) → transition + rank; optimistic UI.
- Realtime: second browser sees moves live (WS + Redis).
- Card detail opens as side-panel modal like Jira.
- Quick-create card at column bottom.

**Parity check:** board layout, DnD feel, live updates, column management.

## Stage 3 — Backlog, sprints & epics (Scrum)
**Goal: full Scrum flow — groom backlog, plan sprint, run it, complete it.**

- Backlog view: ranked list, drag to reorder, drag between backlog ⇄ sprint sections.
- Sprints: create/start/complete (incomplete issues roll to backlog/next sprint — Jira behavior).
- Epics: epic panel in backlog, epic link on issues, epic progress bar.
- Story points + sprint header totals.
- Sub-tasks on issue view.
- Board switches to sprint scope for scrum projects; simple burndown chart.

**Parity check:** backlog grooming session run in both tools; sprint start/complete dialogs.

## Stage 4 — Collaboration: comments, attachments, history, notifications
**Goal: the issue view becomes a collaboration hub like Jira's.**

- Comments (rich text, edit/delete), Activity tabs: Comments / History / All.
- Attachments (MinIO), image thumbnails, attachment strip on issue view.
- Watchers; notifications: in-app bell + feed, email via worker (MailHog in dev).
- @mentions in comments → notification.
- issue_events wired to every mutation (history complete).

**Parity check:** comment thread UX, history tab entries wording, notification triggers table vs Jira defaults.

## Stage 5 — Search, filters & dashboard
**Goal: find anything fast; TQL for power users.**

- TQL parser + `/search`; search page with filter chips (project, type, status, assignee, label) that build TQL, like Jira's issue navigator basic/advanced toggle.
- Saved filters (per user, shareable).
- Global quick-search (top nav) with recent issues.
- Project summary page: status overview donut, recent activity, assignee workload.

**Parity check:** issue navigator side-by-side; TQL vs JQL for the 20 most common query shapes.

## Stage 6 — Jira import/export
**Goal: migrate a real Jira project into TaskHat with one command/screen.**

See [07-jira-import-export.md](07-jira-import-export.md).

- Import from Jira Cloud REST API (URL + email + API token) and from Jira CSV/JSON exports.
- Mapping UI: users, statuses, issue types, priorities; dry-run report before commit.
- Chunked, resumable worker job; progress screen; per-item error report.
- Idempotent re-runs (upsert by jira_id).
- TaskHat → CSV export (round-trip safety).

**Parity check (final):** import a real project; verify counts, keys, statuses, comments, attachments, sprint membership, epic links; side-by-side board comparison of migrated data.

## Stage 7 — Profile & account settings
**Goal: an Atlassian-Account-style `/account` area and public people pages.**

- Profile & visibility: profile photo + header image (S3-stored, served via unguessable
  public keys — Gravatar-style pragmatic security), full name, public name, job title,
  department, organization, location.
- Email change (password-confirmed). Password change (revokes all other sessions).
- Security: active sessions with device / IP / last-active, revoke one or all others.
  Sessions tracked in Postgres; refresh tokens in Redis reference the session.
  (2FA/TOTP deliberately deferred.)
- Preferences: timezone, theme persisted server-side (follows the user across devices).
- People pages: `/people/{id}` — banner, avatar, title/org, shared spaces, open work items.
- Avatars render everywhere the app shows a user.

**Parity source:** user's screenshot of Atlassian Account (Profile and visibility page).

## Stage 8 — Space settings ✅ (shipped)
**Goal: Jira's Project settings, per space, admin-gated.**

- Details: rename, description, avatar, lead (always promoted to space admin),
  default assignee (applied when a work item is created without one).
- Access: role picker per member, remove member — self and lead protected; adding
  members stays on the existing People/Add-member flow.
- Board: column rename/WIP/reorder + status management (add/rename/delete within the
  three categories; adding a status appends a mapped board column; delete blocked while
  work items use it). **Migration 0010 gave every space its own workflow** (cloned from
  the shared default, statuses/transitions/issues/column-mappings remapped), so status
  edits never leak across spaces. *Deliberate adaptation: Jira splits this across Board
  settings and the workflow editor; we fold a simplified version in, the way
  team-managed projects do.*
- Labels: rename / merge (rename onto an existing label) / delete, with usage counts.
- Notifications: per-space toggles for which events email watchers (`notify_prefs`
  jsonb); in-app notifications and @mention emails always send.
- Danger zone: archive (hidden from space list & search, direct links keep working,
  reversible) and delete (type-the-key confirmation).
- UI: Settings tab in the space tab strip → `/projects/{key}/settings/{section}` with
  Jira-style left sub-nav; space avatars render in the sidebar, space list and header.

## Stage 9 — Admin settings
**Goal: site administration modeled on admin.atlassian.com.**

- `is_admin` flag; the first registered account becomes the site admin.
- User management: list, invite by email (link → set-password), deactivate/reactivate,
  promote to admin, force password reset, and claim imported placeholder accounts
  (*TaskHat-specific: an invited real user inherits an imported user's history*).
- Registration policy: open ⇄ invite-only toggle (invite-only recommended once live).
- Spaces overview across the site; reassign lead; delete.
- Site settings in DB (site name, base URL, SMTP — *a Jira Data Center trait, kept
  because TaskHat is self-hosted*). System page: worker/queue health, import jobs, counts.

# Settings stages (10–13) — parity with Jira's gear menu

**Parity source:** user's screenshot of Jira's settings menu (gear icon), 2025 design.
Structure to replicate: *Personal Jira settings* (General settings, Notification
settings) / *Jira admin settings* (System, Jira apps, Spaces, Work items, Marketplace
apps) / *Atlassian admin settings* (User management, ~~Billing~~). **Billing is
explicitly out of scope** (user decision). "Jira apps"/"Marketplace apps" have no
meaning in a self-hosted single app — adapted to **Integrations** (webhooks, API
tokens) in Stage 13.

## Stage 10 — Settings menu + personal settings ✅ (shipped, then reworked for exact parity)

**Parity rework (2026-07-07, from two more user screenshots):**
- **Settings sidebar takeover**: on any `/admin/*` or `/settings/*` page the app sidebar
  is replaced by Jira's settings sidebar — back arrow + area title, a **Switch settings**
  dropdown (System / Spaces / User management / Work items / Integrations), and the
  System section groups exactly as in Jira: General configuration, Beta features,
  Troubleshooting and support (Audit log, System info), Security (Space roles, Global
  permissions, Work item collectors), Automation (Global automation), User interface
  (Default user preferences, Default dashboard), Mail (Outgoing mail, Incoming mail).
  Not-yet-built entries are visible but grayed with Stage-12/Backlog badges.
- **Admin URLs**: /admin/system/{general,info,mail}, /admin/spaces, /admin/users
  (old /admin?tab=… redirects kept).
- **General configuration** is Jira's read-only view + "Edit settings": General Settings
  (Title, Email from, Introduction — shown on the log-in screen, Sign-up mode) and
  Internationalization (Default language, Indexing language). New site_settings keys:
  `introduction`, `default_language`; public `/site` returns the introduction.
- **Outgoing mail** page (SMTP host, From address; test-email marked Stage 12).
- **Command palette** (⌘/Ctrl+K, and via the gear menu's "Search ( ⌘ + K )" button):
  Jira's layout — Search work row ("/" prefix live-searches work items via quicksearch),
  Quick actions (Create work item with the global **C** shortcut, Copy current page URL,
  Check notifications), Site navigation (View my open work items), Give feedback; typing
  filters actions and settings.
- Fixed a prod-only React #130: @atlaskit/icon-object glyphs now also route through the
  coreIcons fix() interop wrapper.
**Goal: the gear icon opens Jira's settings panel; personal settings get their own pages.**

- Gear icon opens a right-anchored settings menu (not a page): section headers
  **Personal settings** / **Admin settings** (admin section only for site admins),
  icon + title + one-line description per item, search field on top that filters
  the items. Mirrors the screenshot's layout.
- Menu items: General settings, Notification settings (personal) → System, Spaces,
  Work items, User management, Integrations (admin; each deep-links into `/admin`
  tabs or the new pages).
- `/settings/general` — personal preferences page: timezone, theme (moved/shared
  with Account → Preferences), language selector (English now; wired for future
  i18n), start-of-week, default landing page (For-you / Spaces / a specific space).
- `/settings/notifications` — **per-user** notification preferences: for each event
  kind (created / status change / updated / comments / mentions) choose in-app and/or
  email; global email kill-switch. Worker resolution order: user prefs AND space
  prefs AND site SMTP — most restrictive wins (mention email obeys user prefs but
  not space prefs, as today).
- New table `user_notify_prefs` (or jsonb on users) + `/api/v1/account/notifications`.

## Stage 11 — Work items admin (types, workflows, fields) ✅ (shipped)
**Goal: Jira's "Work items" admin section — configure work types, workflows, fields.**

**Shipped 2026-07-08:** migration 0012 (work_types seeded with the five built-ins,
custom_fields + issue_field_values, issues.type CHECK dropped — validation now goes
through the registry). Admin area /admin/work-items/{types,workflows,fields} wired
into the settings sidebar, gear menu and command palette. **Transitions are now
enforced**: the Stage-1 transitions table drives the issue-view menu AND board drags
(bare status ids still accepted but validated); deleting the last transition to a
status makes it unreachable, and the editor warns when a space has none. Custom
fields ride on every issue payload as `custom` and are editable in the create modal
and Details panel; TQL supports `cf["Name"]` (=, !=, ~, !~, EMPTY, and > < >= <= for
numbers). Custom work types render a colored initial icon app-wide via the icon
registry. Deliberate scope: transition *rules* (validators/post-functions) and
screen schemes remain out — fields simply appear for their scope.

- **Workflow editor**: per-space (owns its workflow since Stage 8) — visual list of
  statuses with transitions between them: create named transitions (from → to,
  or "any status"), delete transitions; board/issue transition menus obey them
  (today every status is reachable from anywhere — this makes transitions real).
- **Work types**: site-wide defaults + per-space enable/disable of epic / story /
  task / bug / subtask; per-space custom work types (name, icon, color) stored in
  a `work_types` table; create-modal and TQL pick them up.
- **Custom fields** (first cut): admin defines fields (text, number, date, select)
  site-wide or per-space; values stored in `issue_field_values` jsonb; rendered in
  the issue Details panel + create modal; TQL `cf["Field name"]` support.
- Screens deliberately simplified: one layout, fields toggle on/off per space
  (*Jira's screen schemes are overkill for team-managed parity*).

## Stage 12 — System admin ✅ (shipped)
**Goal: Jira's System page — general configuration, security, operations.**

**Shipped 2026-07-11:** migration 0013 (audit_log, space_categories +
projects.category_id). Every "Stage 12" badge in the System sidebar is now live:
**Audit log** (append-only trail of sign-ins incl. failures/lockouts, invites, user
admin, settings, space and workflow changes — filterable, paged), **Security**
(session lifetime, minimum password length, failed-login lockout via Redis counters —
all enforced immediately), **Global permissions** (create-spaces: everyone ⇄
admins-only, enforced; admins list), **Space roles** (reference), **Default user
preferences** (timezone/language/landing applied to new accounts), **Outgoing mail**
gained *Send test email*, **System info** gained live RabbitMQ queue depths, and the
Spaces area gained **Space categories** (create/assign per space in Manage spaces)
and **Archived spaces** (site-admin unarchive without membership).

- General configuration: site name (exists), base URL, default timezone/language
  for new users, default landing page.
- Security: session lifetime (refresh TTL), minimum password length, failed-login
  lockout (N attempts → cooldown), sign-out-everywhere per user (admin-triggered).
- Email: SMTP settings (exists) + **send test email** button; incoming-mail noted
  as backlog.
- Operations: queue/worker health (RabbitMQ depth per queue), import jobs (exists),
  **audit log** — site-wide event feed (who did what, when) with filters, backed by
  the existing events pipeline persisted to an `audit_log` table.
- Spaces admin upgrades (the menu's "Spaces" line): space **categories** (create,
  assign, filter by), archived-spaces view with unarchive, bulk lead reassignment.

## Stage 13 — Integrations (in place of Jira/Marketplace apps) ✅ (shipped)
**Goal: the useful subset of Jira's app ecosystem for a self-hosted tool.**

**Shipped 2026-07-12 — the final planned stage.** Migration 0014 (webhooks,
webhook_deliveries, api_tokens). **Webhooks** (Admin → Integrations): name, URL,
optional HMAC-SHA256 secret (`X-TaskHat-Signature`), event filter (issue
created/updated/transitioned/deleted, comment added, space created, or `*` —
sprint events deferred: no such domain events exist yet), scope one space or all,
enable/disable toggle, delivery log (status, attempts, error; newest 200 kept)
with 3-attempt retries — dispatched from a dedicated worker queue. **API tokens**
(Personal settings): labeled `tk_…` tokens shown once, SHA-256-hashed at rest,
prefix + last-used display, revoke; accepted as `Authorization: Bearer` across
the whole REST API. Both audited. Verified end-to-end against a live receiver
(signature validated, out-of-scope events filtered, network failures logged with
3 attempts).

- **Webhooks**: admin-defined outgoing webhooks — URL, secret (HMAC signature),
  event filter (issue created/updated/transitioned, comment added, sprint events),
  per-space or site-wide scope, delivery log with retries (worker-driven).
- **API tokens**: personal access tokens (create/label/revoke, hashed at rest,
  last-used timestamp) usable as `Authorization: Bearer` for the REST API —
  enables scripts/CI like Jira API tokens.
- Settings-menu items "Jira apps"/"Marketplace apps" intentionally not reproduced.

# Automation stages (14–15) — Jira automation parity

**Parity sources:** Atlassian's automation docs (triggers / conditions / actions /
branches / smart values, checked 2026-07-12). DevOps, JSM, design and Loom triggers
are out of scope — TaskHat has no such subsystems.

**Architecture (rides what exists):** rules are data — `automation_rules`
(name, scope: one space or global, trigger jsonb, conditions jsonb, actions jsonb,
is_enabled, allow_self_trigger, throttle) + `automation_runs` (per-run status +
per-component log, pruned like webhook deliveries). The engine is a worker consumer
on a new `automation` queue bound to all domain events, plus a 1-minute scheduler
tick for Scheduled rules. A system user **"TaskHat Automation"** (no password — can
never log in) performs every action, so history/audit attribute correctly, and
**loop prevention** works like Jira's: events caused by the automation actor don't
trigger rules unless the rule opts in ("Allow rule to trigger other rules").
**Smart values** — `{{issue.key}}`, `{{issue.summary}}`, `{{issue.status.name}}`,
`{{issue.assignee.displayName}}`, `{{issue.url}}`, `{{trigger.comment.body}}`,
`{{actor.displayName}}`, `{{now}}` / `{{now.plusDays(n)}}` — render in comments,
emails, web requests and field values.

## Stage 14 — Automation engine + flow builder ✅ (shipped 2026-07-12)
**Goal: Admin → System → Global automation goes live with Jira's flow builder — same
canvas, same quality (user's dark-mode screenshot of the new builder is the parity
source).**

**Scope adjustment (2026-07-12):** branches move UP from Stage 15 into 14 — the
user's reference rule ("Children Done = Epic Done": on transition to Done, if type
in (Story, Task) and a parent exists, For: Parent → if all children Done → move the
parent to Done) requires them. The rule editor is a **canvas** (dotted grid, node
cards connected by lines, BRANCH sections, zoom control) with a right-hand panel:
Name / Description / Scope (Global ⇄ Single space) / **Owner** (receives failure
emails) / **Actor** (fixed: "Automation for TaskHat") / **Notify on error**
(email owner once when the flow starts failing / every time / never), plus an
Enabled toggle and Save in the editor top bar.

**Shipped:** migration 0015 (automation_rules, automation_runs, seeded passwordless
system user "TaskHat Automation"). Engine = worker consumer on the `automation`
queue + 30s scheduler tick; loop prevention (automation-actor events skipped unless
the flow opts in), per-rule throttle (60/min), auto-disable after 10 consecutive
failures with owner email per the notify-on-error policy; every mutation the engine
makes is re-published so notifications, webhooks and live boards react normally.
Verified end-to-end with the reference flow **"Children Done = Epic Done"** on real
data: transition → TQL condition → parent-exists → For: Parent branch → all-children
-done check → epic transitioned + commented by "TaskHat Automation", exactly one run
logged (the epic's own automation transition did not re-trigger). Canvas editor
matches the reference screenshot in light and dark.

- Triggers: Work item created / updated / transitioned / assigned / commented /
  deleted, Space created, Multiple work item events, **Scheduled** (interval, with an
  optional TQL that fans the rule out over every matching work item).
- Conditions: work item field condition (type/status/priority/assignee/reporter/
  labels; equals / not / in / empty), **TQL condition** (reuses the parser — Jira's
  JQL condition), user condition (actor is / is not).
- Actions: Edit fields (assignee incl. smart options "space lead" and "reporter",
  priority, labels add/remove, sprint, due date, custom fields), Transition work
  item (workflow-validated), Add comment, Send email (site SMTP), **Send web
  request** (reuses the webhook dispatcher incl. HMAC signing), Create work item.
- UI: Global automation page — rule list (enable toggle, scope, last-run status) +
  Jira-style vertical rule builder (When → If → Then chain) + per-rule **run log**
  showing each component's outcome and rendered smart values.
- Guardrails: loop prevention (above), per-rule throttle (max executions/minute),
  auto-disable after N consecutive failures (Jira's service-limit behavior), and
  every rule change + auto-disable lands in the Stage-12 audit log.

## Stage 15 — Automation power features ✅ (shipped 2026-07-12)
**Goal: the features that make Jira automation feel unbounded.**

**Shipped:** **if/else blocks** (single condition + IF/ELSE arms on the canvas, both
independently extendable), **field value changed** trigger (watched-field filter;
`issue.field_changed` events now published on edits with the changed field names),
**sprint triggers** (sprint.created/started/completed domain events now published —
also available to webhooks — with `{{sprint.name}}` smart values usable inside
branch/condition TQL), **manual trigger** (⚡ menu on the work item view, member-run,
audited), **incoming webhook** trigger (tokenized public URL, 60/min rate limit,
optional `{"issueKey": …}` context), **per-space Automation tab** in Space settings
(space admins get the full canvas editor for their space's flows via
`/projects/{key}/automation`; global flows shown read-only; site-admin API stays
403 for non-admins), and a **templates gallery** (Children-Done=Epic-Done,
auto-assign to lead, close stale items, high-priority alert with if/else, welcome
comment — one click opens the editor prefilled). All verified end-to-end.

- **If / else blocks** instead of stop-on-first-failed-condition only.
- More triggers: **Field value changed** (specific fields, from → to), Sprint
  created / started / completed (requires publishing sprint domain events — small
  backend addition), **Manual trigger** from the work item ⋯ menu, **Incoming
  webhook** trigger (ties into Stage-13 integrations).
- Per-space **Automation tab in Space settings** — space admins manage their own
  rules; global rules shown read-only (Jira's project automation).
- Smart values expansion: list helpers ({{issue.labels.join(", ")}}), date
  formatting, {{createdIssue.key}} after a Create action.
- **Templates gallery**: auto-assign to space lead, close stale items after N days,
  sum story points up to the epic, notify on high-priority created, welcome comment
  on first work item — one-click install, then edit.

# Product-depth stages (16–19) — "Track B" (user-approved 2026-07-12)

Track A (production hardening: git init, backups, TLS/domain, key rotation, real
SMTP, permanent e2e suite) remains open and recommended — user chose product depth
first.

## Stage 16 — Rich text editor ✅ (shipped 2026-07-12)
**Goal: Jira-grade rich text for descriptions and comments (TipTap/ProseMirror —
the same document model family as Jira's ADF).**

**Shipped:** migration 0016 (`description_doc`, `body_doc` jsonb). TipTap v2 editor
(bold/italic/strike/code, H1–3, lists, quote, code block, links, **@mention picker**
with avatars) in the work item description, comments (new + edit) and the create
dialog; read views render docs to HTML with themed styles, legacy plain text renders
unchanged. The server derives the plain mirror (docText walk) so TQL text search,
notification previews, CSV export and webhooks needed zero changes — verified:
mirror extracted + searchable, mention nodes produced a mention notification with a
readable preview, formatting-only edits persist. Deferred as planned: inline images,
ADF→TipTap on import.

- Editor: bold/italic/code marks, headings, bullet & numbered lists, blockquote,
  code block, links, **@mentions with a user picker** (mention nodes carry user ids).
- Storage: canonical TipTap JSON in new `description_doc` / `body_doc` jsonb columns;
  the existing plain-text columns become derived mirrors (server-side extraction) so
  **search (search_tsv), notification previews, CSV export and webhooks keep working
  unchanged**. Legacy plain-text content renders as-is.
- Mentions from doc nodes drive notifications (legacy @email in plain text still
  honored).
- Deliberate deferrals: inline images (attachment auth model doesn't fit <img> yet),
  ADF→TipTap conversion on Jira import (imported items keep readable plain text).

## Stage 17 — Work item links ✅ (shipped 2026-07-12)
**Goal: Jira's issue links.**

**Shipped:** migration 0017 (`issue_links` with blocks / relates / duplicates,
directional Jira semantics — "TH-1 blocks TH-2" ⇔ "TH-2 is blocked by TH-1", relates
is symmetric; duplicates in either direction rejected, self-links rejected).
Work item view gets a **Linked work items** section: grouped by relationship phrase,
type icon + key + summary + status lozenge per row, hover-remove, and an add row
(relationship picker + live work-item search). Cross-space links require membership
of both spaces. **`issue.linked` / `issue.link_deleted` domain events** feed
automation (new triggers + `{{link.type}}`/`{{link.otherKey}}` smart values + a
**For: Linked items** branch) and webhooks. TQL: `linked = TH-2`, `linked = EMPTY`.
Known nuance: link smart values carry the raw type, not the directional phrase. `issue_links(from, to, type)` with blocks / is blocked
by / relates to / duplicates; link section on the work item view (typed groups, add
via quick-search picker, remove); "Work item linked / link deleted" automation
triggers + a linked-items branch; TQL `linked = TH-1`; links in webhook payloads.

## Stage 18 — Dashboards ✅ (shipped 2026-07-12)
**Goal: Jira dashboards with gadgets.**

**Shipped:** migration 0018 (`dashboards` + `dashboard_gadgets`). A **Dashboards**
entry in the sidebar opens the directory (create / share / delete); each dashboard is
a Jira-style two-column gadget grid with an **Add a gadget** side panel, per-gadget
⋯ menu (edit settings, move up/down/across, remove) and a persisted layout. Gadget
set: **Work items (TQL)**, **Pie chart** (group by status/type/priority/assignee),
**Activity stream** (all spaces or one), **Workload**, **Sprint burndown** (resolves
the space's active sprint), **Quick links**, **Text**. TQL gained **currentUser()**
(JQL parity), so shared dashboards show per-viewer queries. The seeded **default
dashboard** mirrors Jira's (Introduction / Assigned to Me / Activity Stream): everyone
sees it, only admins edit it, and System → **Default dashboard** now links to it
(BACKLOG badge retired). Dashboards are private by default, shareable with everyone;
private ones 404 for other users. `dashboards` + `dashboard_gadgets` (layout
jsonb); gadget set: TQL results list, pie/status chart, sprint burndown, workload,
activity stream, quick links; per-user + shared dashboards; a default site dashboard
(lights up the System-sidebar "Default dashboard" badge); "Dashboards" in the top
nav/sidebar.

## Stage 19 — Arabic + RTL internationalization ✅ (shipped 2026-07-13)
**Goal: the language switch becomes real.**

**Shipped:** a lightweight i18n layer (`src/i18n`) keyed by English source strings —
`t()` with `{var}` interpolation, `fmtDate`/`fmtDateTime`/`timeAgo` via `Intl` with the
ar locale (Western digits kept), and an **866-string Arabic catalog** covering the whole
UI: shell, boards, backlog, work item view, search, dashboards, account/personal
settings, and the entire admin area including the automation flow builder. Language
resolution: account preference (Stage 10) wins after login, the site default (Stage 12)
drives the signed-out login page, switching reloads the app (like Jira) and sets
`dir=rtl`/`lang=ar`. **Full RTL flip**: the sidebar and settings takeover mirror to the
right, physical left/right inline styles were converted to logical properties
(`paddingInline`, `borderInlineEnd`, `insetInlineEnd`, `textAlign:end`). TQL keeps its
English grammar (like JQL). Known gaps (data, not chrome): stored content — seeded
default-dashboard gadget titles, link relationship phrases, priority/status/work-type
names — and worker emails remain English. i18n message catalog (en/ar), RTL layout
flip (dir=rtl, logical CSS), Arabic translations for the full UI, per-user language
already stored (Stage 10) + site default (Stage 12); date/number localization.


# Planned feature stages (specced, apply on request)

## Stage 20 — Timeline (roadmap view) ✅ (shipped 2026-07-16)
Jira's Gantt-style Timeline per space, at the Timeline tab (after Summary).

**Shipped (migration 0027, `issues.start_date`):** work items render as bars
on a time axis (start → due); epics are swimlanes with expand/collapse and a
translucent **rollup bar** spanning their children when the epic itself has
no dates. **Drag** a bar to reschedule (start+due shift together), **drag an
edge** to change one end; a click opens the work item. Undated rows show an
"Add dates" ghost at today. **Dependency arrows** connect in-project
"blocks" links; orange **today marker**; **Weeks / Months / Quarters** zoom
+ a Today button in the bottom corner, like Jira. Subtasks are excluded
(too granular for a roadmap). Start date also joined the issue Details
panel, the changelog, and TQL (`start >= "2026-08-01"`, `start = EMPTY`).
Deferred: drag-to-create dependencies from bar dots, drag rows between
epics, sprint/release markers on the axis.

## Stage 21 — Releases (versions) ✅ (shipped 2026-07-17)
**Shipped (migration 0029: `versions` + `issue_fix_versions`):** a
**Releases** tab on every space — versions table (status lozenge, green
done-vs-open **progress bar**, start/release dates, ⋯ actions), create/edit
modal, and a **release dialog** that warns about unresolved work items and
offers to move them to another version (Jira's flow); versions can also be
unreleased, archived (hidden behind "Show archived"), restored, and deleted
(admin-only; work items keep their other versions). Each version has a
**release page** listing its work items, done last. Work items carry
multi-value **Fix versions** (Details panel select, changelog entries,
`fixVersions` in the fields envelope), and TQL learned
`fixVersion = "1.0"` / `!= / EMPTY`. Deferred: release notes generation,
version merge, driving releases from the board.

## Stage 22 — Time tracking & worklogs ✅ (shipped 2026-07-17)
**Shipped (migration 0031: estimate columns + `worklogs`):** work items
carry an **Original estimate** (Jira duration format — `2w 1d 4h 30m`,
1w = 5d, 1d = 8h) and a **Time tracking bar** (blue logged vs remaining) in
the Details panel. **Log work** (bar click or the Worklog tab) opens Jira's
dialog: time spent, date started, description, and the remaining-estimate
policy — *adjust automatically* (first log seeds remaining from the
original), *leave as is*, or *set new value*. The Activity section gained a
**Worklog tab** listing entries (author, duration, date, note; delete your
own — admins any). Estimate changes and per-log Time Spent totals land in
the item's history and fire the automation field trigger; TQL learned
`timeSpent > "2h 30m"` / `= EMPTY`; CSV export gained Original Estimate +
Time Spent columns. Deferred: per-space time-tracking toggle, worklog edit
UI (API exists), deleting a log doesn't add its time back to remaining.

## Stage 23 — Security pack: 2FA + SSO ✅ (shipped 2026-07-18)
**Shipped (migration 0032: TOTP columns + `recovery_codes`):**
**Two-step verification** — Account → Security gains a 2FA block: Set up
shows a QR (RFC-6238 TOTP, ±1 step drift) plus the secret, a code confirms
enrollment, and **8 single-use recovery codes** are shown once (hashes
stored). Sign-in becomes two steps: password → short-lived MFA token → the
6-digit code *or* a recovery code (lockout counters apply to the second
step too; enable/disable is audited; disabling needs password + code).
Admins can flip **Require two-step** (site setting → `/site`; unenrolled
people see a "required by your administrator" prompt on the Security tab).
**Single sign-on (OIDC)** — Admin → Security configures issuer / client
id + secret / button label; the login page shows the SSO button;
authorization-code flow with discovery, Redis-backed state, identity from
the provider's userinfo endpoint, **JIT user provisioning** by email
(bypasses invite-only by design — the admin enabled it), session lands via
the refresh cookie. Works with Google/Azure AD/Keycloak or any discovery-
compliant provider. Deferred: hard 2FA-required login block (prompt-based
today), per-user admin 2FA reset, SAML.

## Stage 24 — Permission schemes ✅ (shipped 2026-07-18)
**Shipped (migration 0034: `permission_schemes` + `permission_grants` +
`projects.permission_scheme_id`):** named permission schemes, Jira-style.
A scheme maps 15 permissions (Administer space; create/edit/transition/
assign/link/delete work items; add + edit-all/delete-all comments;
create + delete-all attachments; manage sprints; manage releases; log work)
to grantees: space role (admin/member/viewer), single user, space lead,
reporter, assignee, or any space member. Every space action now resolves
through its space's scheme (`store.HasPermission`, one indexed query;
403s name the missing permission). The seeded default scheme replicates
the old fixed admin/member/viewer behavior, so nothing changed until a
scheme is edited. Site admins implicitly hold Administer space (a
misconfigured scheme can always be repaired). "Own" actions stay free:
everyone edits/deletes their own comments, attachments and worklogs.
Admin UI at Settings → Work items → Permission schemes: scheme directory
(create/copy/delete; default protected), Jira-style grant editor grouped
by section with grant chips + Grant-permission modal; per-space assignment
via a Permission scheme column in Manage spaces; the Space settings Access
section names the space's scheme. `GET /projects/{key}/mypermissions`
exposes the caller's grants. Grants apply on top of membership — visibility
is still membership-based. Deferred: groups as grantees, browse/visibility
permission, per-space roles beyond the fixed trio.

## Stage 25 — Incoming mail → work items ✅ (shipped 2026-07-18)
**Shipped (migration 0038: `mail_handlers`):** Jira's "create work items
and comments from email". Admin → System → Mail → **Incoming mail** manages
handlers: each targets a space + work type and reads mail from one of two
sources — an **inbound webhook** (`POST /api/v1/mail/incoming/{token}`,
unguessable token, rate-limited; mail providers or scripts POST parsed
messages as JSON) or an **IMAP mailbox** the worker polls every minute
(TLS or plain, any folder; unseen messages only, marked seen after
processing; MIME parsed for the first text part + attachments).
Processing is Jira's: subject → summary (Re:/Fwd: stripped), body →
description, attachments carry over (10 MiB / 8 files caps), and when the
subject contains an existing work item key the mail becomes a **comment**
on it instead (toggleable per handler). Senders matching an active
TaskHat account become the reporter/author; unknown senders fall back to
the handler's owner with a "From:" line prefixed. Everything flows
through the normal event pipeline, so notifications, automation rules,
webhooks and live boards react to mailed-in items like any other. The
admin table shows per-handler processed counts, last activity and last
error, with enable/disable, edit (password never echoed) and delete.
Deferred: HTML body conversion (plain text preferred), auto-creating
accounts for unknown senders, per-handler custom field defaults,
Mailgun/SES signature verification adapters.

## Stage 26 — Workflow editor ✅ (shipped 2026-07-21)
**Shipped (migration 0043: `statuses.pos_x/pos_y`, `transition_rules`):**
Jira's team-managed workflow editor as a full-screen takeover at
`/projects/{key}/workflow` (linked from Space settings → Board →
Statuses), with **Diagram and Text views**. Diagram: draggable status
nodes (category-coloured, positions persisted), START marker into the
initial status, transition arrows with arrowheads (curved when a reverse
transition exists), "Any" badges for from-any-status transitions, a
Show-transition-labels toggle, pan/zoom with a minimap + zoom slider
cluster bottom-right. Text: statuses and transitions as clickable lists
(From → To lozenges, rule counts). Toolbar: Add status / Add transition /
Add rule, Update workflow (all edits are a local draft until committed in
one `PUT /projects/{key}/workflow` transaction), Close, and a
"Used in 1 space" chip. Selecting a node or arrow opens a right panel to
rename, recategorise, rewire (From/Any/To), manage rules or delete.
**Rules** (enforced in `TransitionIssue`, so the issue-view status menu
and board drags both respect them): *Restrict who can move an item*
(roles: space lead/admins/members/assignee/reporter, plus specific
people; site admins bypass; violations 403), *Check that a field is
filled* (description/assignee/due date/story points; violations 400),
*Assign the work item* (to a person, Unassigned, or the person who ran
the transition — recorded in the changelog). Transitions with a specific
From status now gate board drags and the transitions menu (from-any
remains supported); the bulk save keeps board columns in sync (new
status → new mapped column on every board, deleted status → mappings and
empty columns dropped, statuses with work items can't be deleted).
Deferred: drag-to-draw transitions on the canvas, per-work-type
workflows/schemes, validators beyond required-fields, post functions
beyond auto-assign.

**26b — admin Workflows directory (shipped 2026-07-21, migration 0044:
`workflows.updated_at`):** Jira's Settings → Work items → **Workflows**
page, replacing the old per-space transition list. The directory shows
every workflow — active ones (assigned to a space) first — with the
spaces using it, a Default/Inactive lozenge, last-edited date and a ⋯
menu: **Edit** (opens the same diagram/text editor at
`/admin/workflows/{id}/edit`, where the workflow can also be renamed
inline), **Copy** (creates an inactive "Copy of X" with statuses,
positions, transitions and rules), **Assign to space…** (the space gets
its own clone, work items are remapped to same-named statuses — initial
status as fallback — resolutions follow the landed category, board
columns are rebuilt, and the space's orphaned old workflow is dropped)
and **Delete** (inactive, non-default only). **Create workflow** seeds a
new inactive workflow from the default statuses. All actions audited
(`workflow.created/copied/assigned/deleted`). Unassigned workflows are
fully editable — no boards or work items to guard, so statuses can be
reshaped freely before assignment. Deleting a space now also drops its
orphaned private workflow, keeping the directory clean.

## Fresh-install bootstrap fix ✅ (2026-07-24)
On a brand-new database no user held `is_admin` (migration 0009 only
promoted an already-existing dev account), leaving fresh Kubernetes
installs with no way to reach Admin settings. `CreateUser` now grants
site admin to the first active account created (register or SSO
auto-provision); seeded inactive system accounts don't count. Verified
end-to-end against a fresh database.

## Authenticated SMTP ✅ (2026-07-25)
Outgoing mail previously spoke only unauthenticated SMTP (fine for
MailHog, rejected by real providers). The mailer now supports SMTP AUTH
(PLAIN) with STARTTLS on submission ports and implicit TLS on :465;
credentials come from `TASKHAT_SMTP_USERNAME`/`TASKHAT_SMTP_PASSWORD` or
Admin → System → Outgoing mail (DB overrides env; password write-only —
the API returns a `********` sentinel that saves ignore, so round-tripping
the form never clobbers it). All senders honor it: notifications, invites,
wiki shares, automation send-email/flow-failure, test email. Helm:
`config.smtpUsername`/`smtpPassword` (password lands in the chart Secret
as `smtp-password`).

## Blob cleanup on issue/space deletes ✅ (2026-07-27)
Mirror of the DocHat fix: deleting a work item or a space now removes its
attachment binaries (and the space avatar) from object storage instead of
orphaning them. Best-effort after the transaction commits, failures
logged; the space-delete audit row records the blob count. Applies to
imported attachments too. Verified against the real bucket (blobcheck).

## Import fidelity: real statuses, custom types, smarter user report ✅ (2026-07-28)
The Jira importer no longer flattens what it finds. **Statuses:** every
Jira status is created for real in the target space's workflow
(name-matched, idempotent; category drives the colour and resolution
behaviour; board columns and from-any transitions come along via
AddStatus), so "Backlog" and "Closed" survive instead of collapsing onto
the default three. **Issue types:** unknown Jira types become custom
work types (site-wide, like Jira's) and imported items keep them —
"Documentation Task" no longer downgrades to Task. **Dry-run report:**
statuses show "new status (category)" vs the matched name, types show
"new work type", and users are matched by Jira account id as well as
email (re-imports and cross-product imports show "matched by Jira
account" instead of pretending they'll be placeholders). Re-running an
import upgrades previously imported spaces in place. New report tiles:
Statuses created / Work types created.

## Kanban Done-column aging ✅ (2026-07-28)
Jira parity: kanban boards hide done work older than 14 days (matching
Jira's cleared Done column) behind a "See older work items" link that
opens the issue navigator with the space's resolved items. Imported
history without resolution dates ages by last update instead. Counts
show visible items; scrum boards are untouched (sprint-scoped already).

## Import Jira's board layout ✅ (2026-07-28)
The scan now captures the project board's column configuration (agile
board → configuration → status names) and the run rebuilds the TaskHat
board to match: same columns, same order, same status-to-column mapping
— so a Jira board whose "To Do" column holds the Backlog status looks
identical after import. Statuses Jira leaves off the board get their own
trailing columns (deliberate deviation: nothing silently disappears).
When a project has several boards, the one named after the project wins,
else the first. CSV imports keep the one-column-per-status fallback.

## Import fidelity II — everything else ✅ (2026-07-28, migration 0045)
Eight more surfaces now come through the Jira import:
**Rich text** — ADF converts to real editor documents (headings, marks,
lists, tables, task lists, panels, status/date chips, links; @mentions
resolve to the imported accounts) for descriptions and comments; media
nodes are skipped (binaries still arrive as attachments).
**Issue links** — blocks/duplicates/relates recreated between imported
items. **Releases & components** — fixVersions become releases (linked
per item), components find-or-create and link. **Worklogs** — idempotent
on the Jira worklog id (`worklogs.jira_id`, migration 0045).
**History** — the full changelog imports as issue events with real
timestamps, once per item (on first creation, since events carry no
provenance). **Watchers** — imported for accounts that can log in;
placeholders are skipped so no dead notifications queue. **Space
avatar** — Jira's project icon becomes the space avatar unless one is
already set. **Custom fields** — Jira text/number/date/select customs
are auto-created globally (select options grow from the values seen)
and values ride along. Scan makes one changelog+watchers call pair per
issue (progress shown). New report tiles for each count.

## Stage 27 — Reports ✅ (shipped 2026-08-02)

Jira's space Reports surface (researched against Jira Cloud docs + user's
screenshots of the UMS board). Reports tab in the space header (before
List, chart-trend icon). Overview page: "More reports" button, four stat
tiles (completed / updated / created in the last 7 days, due in the next
7 days) and three donuts (Work items by status / type / assignee, center
total, hover tooltips, legend with counts; >12 slices fold into "Other").
"More reports" modal mirrors Jira's catalog with SVG thumbnails, grouped:

- **Agile**: Cumulative Flow Diagram (status-category areas over time,
  rebuilt by replaying `issue_events` status history), Control Chart
  (cycle-time scatter + average line + ±1σ band; dots link to items).
- **DevOps**: Cycle Time Report (same engine, outlier table), Deployment
  Frequency Report (honest empty state — no deployment data source yet).
- **Issue analysis**: Average Age, Created vs. Resolved (two lines +
  backlog grew/shrank note), Pie Chart (field selector), Recently Created
  (stacked resolved/unresolved bars), Resolution Time, Single Level Group
  By (tri-color progress rows), Time Since (date-field selector).
- **Other**: Workload Pie Chart (count or remaining-estimate weighting).

Backend: `store/reports.go` aggregates + status-timeline replay;
`GET /projects/{key}/reports/{overview,cfd,cycle-time,pie,groupby,
workload,trend/{trend}}` (member-gated; `days` clamped 7–730; buckets
day/week/month by range). Charts are dataviz-validated (6-hue categorical
palette passes light+dark; status hues for status slices; gray reserved
for To Do/Other), every chart has hover tooltips and a data table.

## Stage 28 — Space settings parity ✅ (shipped 2026-08-02)

Space settings rebuilt to mirror Jira's company-managed project settings
sidebar (from user's Jira screenshots): Details, Summary, People,
Permissions, Notifications ▸ (Settings, Space email audit), Automation,
Features, Toolchain, Workflows, Work items ▸ (Layout, Screens, Fields,
Collectors, Security), Versions, Components, Development tools, Apps,
plus the TaskHat Board group (Columns and statuses, Labels, Danger zone).

- **Details** matches Jira's form: centered icon + Change icon, required
  asterisks, Name*, read-only Space key*, URL, read-only "How your space
  is managed" (TaskHat - software space), Category select, description,
  lead, default assignee. Migration 0046 adds `projects.url` + `features`.
- **Summary**: config overview rows (people, permissions scheme, workflow
  statuses, fields, versions, components, automation) each linking to its
  section.
- **Permissions**: read-only view of the applied permission scheme grants.
- **Space email audit**: worker now records every sent notification email
  in audit_log (`mail.notification`); page lists the last 100 per space.
- **Features**: per-space toggles for Timeline / Backlog / Reports /
  Releases — turning one off hides the tab for everyone (SpaceHeader
  filters on `project.features`).
- **Workflows**: current workflow card with status lozenges + Edit
  workflow (Stage-26 editor).
- **Fields**: space-scoped custom fields CRUD (global fields listed
  read-only) via new `/projects/{key}/fields` endpoints.
- **Versions**: read-only list linking to the Releases tab.
- **Components**: full CRUD (name, description, default assignee, usage
  counts) via `/projects/{key}/components`.
- Layout / Screens / Collectors / Security / Toolchain / Development
  tools / Apps: honest Jira-context pages linking to the TaskHat
  equivalents (webhooks, API tokens, incoming mail).

## Stage 29 — Boards & sidebar parity ✅ (shipped 2026-08-03)

Jira's sidebar interactions (from user's screenshots): hover a space row
for **+** (Create a board popup: Scrum / Kanban cards) and **⋯** (Add to
starred, Add people, Space settings, "Software space · TaskHat-managed"
footer). Spaces can now hold **multiple boards** — every board lists
under its space in the sidebar and routes to
`/projects/{key}/board/{boardId}`; scrum boards work inside kanban
spaces (board behavior keys off `boards.type`). Board rows get their own
⋯ (Add to starred, Add people, Board settings, Delete board — the last
board is protected). **Stars are real now** (migration 0047
`user_stars`): the Starred section lists starred spaces and boards.
**Board settings** is a Jira-style takeover at `/boards/{id}/settings`:
Details (General settings — Board name* editable, Administrators*,
read-only Location; Board filter note), Working Days, Timeline, Layout ▸
Columns (the live column editor) / Swimlanes / Card colors / Card layout
/ Quick filters, plus "View space settings". Backend:
`POST /projects/{key}/boards` (category-triple default columns),
`PUT/DELETE /boards/{id}`, `GET/POST /stars`.

## Stage 30 — Public demo mode ✅ (shipped 2026-08-03)

Read-only guest sandbox for taskhat-demo.syshat.com (off by default;
`TASKHAT_DEMO_MODE` + `TASKHAT_DEMO_CONTACT_URL` env). Migration 0048
adds `users.is_demo`. "Explore the live demo" button on the login page →
`POST /auth/demo` (rate-limited per IP) signs the visitor in as an
auto-provisioned shared `Demo Explorer` account (never admin, no usable
password). A server-side gate rejects every non-GET request from demo
users with a friendly 403 — the sandbox cannot be modified regardless of
UI state, so no reset job is needed. Demo sessions see a persistent
banner with the "Connect on LinkedIn" full-access CTA (the same message
appears when a guest tries to change anything). Site admins choose what
guests see by adding the demo user as a viewer to specific spaces.

## Stage 31 — Demo data seeder ✅ (shipped 2026-08-04)

Admin settings → System → System info gains a **Demo data** card:
one click creates (and one click removes) the sample "Nimbus" dataset —
three TaskHat spaces — Nimbus Mobile, a scrum space (epics,
stories/tasks/bugs across four statuses, a
completed + an active sprint, story points, estimates, worklogs, rich
descriptions, comments with @mentions, labels, components, released +
unreleased versions, issue links, watchers, a space-scoped custom field,
an attachment) plus two kanban spaces, Orbit Platform Ops
(incident/reliability/toil work with a Severity field) and Lumen Design
System (tokens/a11y/RTL work) — and three DocHat spaces — Nimbus Product Wiki (rich Overview, specs + runbooks tree
with panels/tables/task lists/issue chips, page labels, comment thread,
a whiteboard, a blog post, two calendar events), Orbit Platform Handbook
(incident response, postmortem, deploy guidelines) and Lumen Design
System (components, voice & tone). Content is authored by
four deactivated placeholder users (`@demo.taskhat.local`) who can never
log in; the read-only demo guest is granted viewer on both spaces
automatically. `internal/seed` + `GET/POST/DELETE /admin/demo-data`;
removal reuses the standard space-delete paths (S3 blobs included) and
deletes the placeholder users.

### Stage 31.1 — Demo robot + Instagram (2026-08-04)

The demo banner and login page feature N1MB0S, an animated CSS/SVG robot
(patrols, blinks, waves — no external assets, theme-aware) with a
cycling speech bubble pitching visitors to contact the maker. Contact
links now include Instagram (`TASKHAT_DEMO_INSTAGRAM_URL`) beside
LinkedIn.

## Later / backlog
Meilisearch (if Postgres FTS falls short), imported-user cleanup tools
(rename "Former user" placeholders, merge placeholder into an active
account — proposed 2026-07-16, on hold), presigned S3 downloads,
Jira changelog import. Billing intentionally excluded.
