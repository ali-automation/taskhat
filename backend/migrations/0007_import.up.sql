CREATE TABLE import_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source      TEXT NOT NULL CHECK (source IN ('jira_api', 'jira_csv')),
    project_key TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN ('created', 'scanning', 'scanned', 'running', 'done', 'failed')),
    config      JSONB NOT NULL DEFAULT '{}',
    stats       JSONB NOT NULL DEFAULT '{}',
    error       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX import_jobs_owner_idx ON import_jobs (owner_id, created_at DESC);

-- Provenance for idempotent re-imports (issues already have jira_id/jira_key).
ALTER TABLE comments ADD COLUMN jira_id TEXT;
CREATE UNIQUE INDEX comments_jira_idx ON comments (jira_id) WHERE jira_id IS NOT NULL;

ALTER TABLE attachments ADD COLUMN jira_id TEXT;
CREATE UNIQUE INDEX attachments_jira_idx ON attachments (jira_id) WHERE jira_id IS NOT NULL;

ALTER TABLE users ADD COLUMN jira_account_id TEXT;
CREATE UNIQUE INDEX users_jira_idx ON users (jira_account_id) WHERE jira_account_id IS NOT NULL;

CREATE UNIQUE INDEX issues_jira_idx ON issues (jira_id) WHERE jira_id IS NOT NULL;

-- Sprints are recreated by name on import.
CREATE UNIQUE INDEX sprints_board_name_idx ON sprints (board_id, name);
