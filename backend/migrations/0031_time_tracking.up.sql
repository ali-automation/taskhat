-- Stage 22: time tracking — estimates on work items, worklog entries.
ALTER TABLE issues ADD COLUMN original_estimate_seconds BIGINT;
ALTER TABLE issues ADD COLUMN remaining_estimate_seconds BIGINT;

CREATE TABLE worklogs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seconds    BIGINT NOT NULL CHECK (seconds > 0),
    started_at TIMESTAMPTZ NOT NULL,
    comment    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX worklogs_issue_idx ON worklogs (issue_id, started_at DESC);
