CREATE TABLE sprints (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id     UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    goal         TEXT NOT NULL DEFAULT '',
    state        TEXT NOT NULL DEFAULT 'future' CHECK (state IN ('future', 'active', 'closed')),
    start_at     TIMESTAMPTZ,
    end_at       TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sprints_board_idx ON sprints (board_id, state);

-- Only one active sprint per board (Jira behavior).
CREATE UNIQUE INDEX sprints_one_active_idx ON sprints (board_id) WHERE state = 'active';

ALTER TABLE issues ADD COLUMN sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL;
CREATE INDEX issues_sprint_idx ON issues (sprint_id);
