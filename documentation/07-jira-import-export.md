# 07 — Jira Import / Export

Goal: take tasks out of a real Jira instance and load them into TaskHat with high fidelity, idempotently.

## Import sources (in order of fidelity)

### 1. Jira Cloud REST API (recommended)
User supplies site URL + email + API token. The importer pulls directly:

| Data | Jira endpoint |
|---|---|
| Project meta | `GET /rest/api/3/project/{key}` |
| Issues (paged) | `GET /rest/api/3/search?jql=project={key} ORDER BY created ASC&expand=changelog` |
| Comments | expanded via `fields=comment` / per-issue fetch |
| Attachments | `fields=attachment` → download binary via `content` URL |
| Users | `GET /rest/api/3/user/search` (map by accountId) |
| Sprints/boards | Agile API `GET /rest/agile/1.0/board`, `/sprint`, `/sprint/{id}/issue` |
| Epic links | `parent` field / `customfield_epic_link` |

Fetched with rate-limit respect (429 + `Retry-After`), resumable per page.

### 2. Jira CSV export
Jira's "Export issues (CSV, all fields)" from the issue navigator. Covers fields, labels, comments (as columns), sprint names — but no attachments binaries, no changelog. Parser must handle Jira CSV quirks: repeated columns (`Comment`, `Labels`, …), `key: value; ...` comment encoding, locale date formats (configurable format string in mapping UI).

### 3. Jira JSON (backup/export)
Jira Cloud advanced export / server XML-to-JSON. Parsed if provided; lowest priority.

## Mapping

Interactive mapping step (with sensible defaults) before commit:

| Jira | TaskHat | default rule |
|---|---|---|
| Issue type | type | Epic→epic, Story→story, Task→task, Bug→bug, Sub-task→subtask; custom types → task (overridable) |
| Status | status | by name match against target workflow; unmatched → choose per status; option "create status" |
| Priority | priority | name match; custom → medium |
| User (accountId) | user | by email when visible; else placeholder deactivated user `jira:accountId` (re-linkable later) |
| ADF description/comments | TipTap JSON | ADF→TipTap converter (both ProseMirror-based); unknown nodes degrade to text |
| Sprint | sprint | recreate by name with dates; closed sprints imported closed |
| Epic Link / parent | parent_id | second pass after all issues exist |
| Issue links | issue_links | mapped link types; unknown → relates_to |
| Rank | rank | preserve Jira order (imported in rank order → assign fresh ranks) |
| Story points | story_points | native field; the site-specific Jira field is discovered by name (`Story Points`, `Story point estimate`) — never hardcoded to `customfield_10016` only, and never imported as a custom field |
| Original / remaining estimate | original_estimate_seconds / remaining_estimate_seconds | from `timetracking` (falling back to `timeoriginalestimate`/`timeestimate`); shows as Jira durations in Details + Time tracking |
| Start date | start_date | site-specific `Start date` field discovered by name; never imported as a custom field |
| Changelog | issue_events | noise fields Jira hides (`worklogid`, `workratio`, `rank`) dropped; time-tracking events renamed to Jira's labels with values as durations (`0m → 1w`); a repair pass (`ImportCleanHistory` + `ImportRetireCustomFields`) runs on every import to fix rows written by older importer versions in place |

Issue keys: TaskHat project uses the same key (e.g. `PROJ`) and **preserves issue numbers** (`PROJ-42` stays `PROJ-42`); `issue_seq` set to max imported number. Original id kept in `jira_id`/`jira_key`.

Cleanup: every scan stores a snapshot blob (`imports/{jobId}.json`; CSV
imports also keep the uploaded file). `DELETE /import/jira/{id}` removes a
finished job together with those blobs (running jobs 409). Deleting a
space (TaskHat or DocHat) also deletes the import jobs that targeted it,
snapshots included — nothing of the imported data is left in the bucket.

## Pipeline (worker job)

```
validate creds/file → dry-run scan (counts, unmapped values) → user confirms mapping
→ phase 1: users → phase 2: sprints → phase 3: issues (paged, upsert by jira_id)
→ phase 4: parents/epic links + issue links → phase 5: comments → phase 6: attachments (download+store)
→ report: imported/updated/skipped/failed per entity, with per-item errors
```

- Runs in `worker` via RabbitMQ; progress persisted in `import_jobs.stats` (jsonb), streamed to UI via WebSocket.
- **Idempotent:** every entity upserts on `jira_id` — re-running a failed job continues, and re-importing later syncs changes.
- Attachments streamed to storage, never buffered whole in memory.

## Export (TaskHat → out)
- CSV export compatible with Jira's CSV *import* format — escape hatch back to Jira, and round-trip test fixture.
- JSON export of full project (our own schema) for backup/restore.

## Testing strategy
- Golden-file tests: recorded Jira API JSON responses + a real anonymized CSV export as fixtures → import into testcontainers Postgres → assert entity counts and field fidelity.
- Round-trip test: TaskHat → CSV → import into fresh TaskHat → diff.
