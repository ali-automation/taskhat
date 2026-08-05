CREATE TABLE boards (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'kanban' CHECK (type IN ('kanban', 'scrum')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX boards_project_idx ON boards (project_id);

CREATE TABLE board_columns (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INT NOT NULL,
    min_issues INT,
    max_issues INT
);

CREATE INDEX board_columns_board_idx ON board_columns (board_id, position);

-- Jira maps N statuses to one column.
CREATE TABLE board_column_statuses (
    column_id UUID NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    status_id UUID NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
    PRIMARY KEY (column_id, status_id)
);

-- Backfill: one default board per existing project, columns mirroring the
-- project's workflow statuses 1:1.
INSERT INTO boards (project_id, name, type)
SELECT id, key || ' board', project_type FROM projects;

INSERT INTO board_columns (board_id, name, position)
SELECT b.id, s.name, s.position
FROM boards b
JOIN projects p ON p.id = b.project_id
JOIN statuses s ON s.workflow_id = p.workflow_id;

INSERT INTO board_column_statuses (column_id, status_id)
SELECT c.id, s.id
FROM board_columns c
JOIN boards b ON b.id = c.board_id
JOIN projects p ON p.id = b.project_id
JOIN statuses s ON s.workflow_id = p.workflow_id AND s.name = c.name;
