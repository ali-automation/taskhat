-- Stage 25: incoming mail → work items (Jira's "create issue or comment from email").
CREATE TABLE mail_handlers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_type      TEXT NOT NULL DEFAULT 'task',
    mode            TEXT NOT NULL CHECK (mode IN ('webhook', 'imap')),
    token           TEXT UNIQUE,                       -- webhook mode: unguessable inbound URL part
    imap_config     JSONB NOT NULL DEFAULT '{}'::jsonb, -- {host, port, tls, username, password, folder}
    allow_replies   BOOLEAN NOT NULL DEFAULT TRUE,      -- issue key in subject → comment
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    last_polled_at  TIMESTAMPTZ,
    last_error      TEXT NOT NULL DEFAULT '',
    processed_count INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
