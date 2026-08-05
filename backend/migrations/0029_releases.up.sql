-- Stage 21: Releases (versions), like Jira's fix versions.
CREATE TABLE versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    start_date   DATE,
    release_date DATE,
    status       TEXT NOT NULL DEFAULT 'unreleased'
                 CHECK (status IN ('unreleased', 'released', 'archived')),
    released_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

CREATE TABLE issue_fix_versions (
    issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, version_id)
);
CREATE INDEX issue_fix_versions_version_idx ON issue_fix_versions (version_id);
