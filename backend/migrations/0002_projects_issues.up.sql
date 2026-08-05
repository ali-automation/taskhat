CREATE TABLE workflows (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE statuses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('todo', 'in_progress', 'done')),
    position    INT NOT NULL,
    UNIQUE (workflow_id, name)
);

-- from_status_id NULL means the transition is available from any status.
CREATE TABLE transitions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id    UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    from_status_id UUID REFERENCES statuses(id) ON DELETE CASCADE,
    to_status_id   UUID NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
    name           TEXT NOT NULL
);

CREATE TABLE projects (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key          TEXT NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    lead_id      UUID NOT NULL REFERENCES users(id),
    workflow_id  UUID NOT NULL REFERENCES workflows(id),
    project_type TEXT NOT NULL DEFAULT 'kanban' CHECK (project_type IN ('kanban', 'scrum')),
    issue_seq    BIGINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE issues (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number       BIGINT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('epic', 'story', 'task', 'bug', 'subtask')),
    parent_id    UUID REFERENCES issues(id) ON DELETE SET NULL,
    summary      TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status_id    UUID NOT NULL REFERENCES statuses(id),
    priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('highest', 'high', 'medium', 'low', 'lowest')),
    assignee_id  UUID REFERENCES users(id),
    reporter_id  UUID NOT NULL REFERENCES users(id),
    story_points NUMERIC,
    rank         TEXT NOT NULL COLLATE "C",
    due_date     DATE,
    resolution   TEXT CHECK (resolution IN ('done', 'wont_do', 'duplicate', 'cannot_reproduce')),
    resolved_at  TIMESTAMPTZ,
    jira_id      TEXT,
    jira_key     TEXT,
    search_tsv   TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', summary || ' ' || description)) STORED,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, number)
);

CREATE INDEX issues_project_status_idx ON issues (project_id, status_id);
CREATE INDEX issues_rank_idx ON issues (project_id, rank);
CREATE INDEX issues_assignee_open_idx ON issues (assignee_id) WHERE resolution IS NULL;
CREATE INDEX issues_search_idx ON issues USING GIN (search_tsv);

CREATE TABLE labels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    UNIQUE (project_id, name)
);

CREATE TABLE issue_labels (
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, label_id)
);

CREATE TABLE components (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    default_assignee_id UUID REFERENCES users(id),
    UNIQUE (project_id, name)
);

CREATE TABLE issue_components (
    issue_id     UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, component_id)
);

-- Immutable audit trail; powers the History tab and notifications.
CREATE TABLE issue_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actor_id   UUID NOT NULL REFERENCES users(id),
    field      TEXT NOT NULL,
    old_value  JSONB,
    new_value  JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX issue_events_issue_idx ON issue_events (issue_id, created_at);

-- Seed the default workflow with Jira's default statuses. Fixed UUIDs so
-- code and later migrations can reference them.
INSERT INTO workflows (id, name, is_default) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Default workflow', TRUE);

INSERT INTO statuses (id, workflow_id, name, category, position) VALUES
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'To Do',       'todo',        1),
    ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'In Progress', 'in_progress', 2),
    ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Done',        'done',        3);

INSERT INTO transitions (workflow_id, from_status_id, to_status_id, name) VALUES
    ('00000000-0000-0000-0000-000000000001', NULL, '00000000-0000-0000-0000-000000000011', 'To Do'),
    ('00000000-0000-0000-0000-000000000001', NULL, '00000000-0000-0000-0000-000000000012', 'In Progress'),
    ('00000000-0000-0000-0000-000000000001', NULL, '00000000-0000-0000-0000-000000000013', 'Done');
