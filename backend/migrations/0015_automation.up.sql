CREATE TABLE automation_rules (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    scope_project_id     UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL = global
    owner_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    trigger              JSONB NOT NULL,
    components           JSONB NOT NULL DEFAULT '[]',
    is_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    allow_self_trigger   BOOLEAN NOT NULL DEFAULT FALSE,
    notify_on_error      TEXT NOT NULL DEFAULT 'once' CHECK (notify_on_error IN ('once', 'always', 'never')),
    consecutive_failures INT NOT NULL DEFAULT 0,
    last_run_at          TIMESTAMPTZ,
    next_run_at          TIMESTAMPTZ, -- scheduled trigger bookkeeping
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE automation_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id     UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,
    item_key    TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL CHECK (status IN ('success', 'no_action', 'failure')),
    log         JSONB NOT NULL DEFAULT '[]',
    duration_ms INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX automation_runs_rule_idx ON automation_runs (rule_id, created_at DESC);

-- The rule actor: performs every automation action; can never log in
-- (inactive => excluded from login and people pickers).
INSERT INTO users (email, password_hash, display_name, is_active)
VALUES ('automation@taskhat.local', '', 'TaskHat Automation', FALSE)
ON CONFLICT (email) DO NOTHING;
