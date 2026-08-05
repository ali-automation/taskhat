CREATE TABLE work_types (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key        TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    glyph      TEXT NOT NULL DEFAULT 'task' CHECK (glyph IN ('epic', 'story', 'task', 'bug', 'subtask')),
    color      TEXT NOT NULL DEFAULT '#357DE8',
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    builtin    BOOLEAN NOT NULL DEFAULT FALSE,
    position   INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO work_types (key, name, glyph, color, builtin, position) VALUES
    ('epic',    'Epic',     'epic',    '#904EE2', TRUE, 1),
    ('story',   'Story',    'story',   '#36B37E', TRUE, 2),
    ('task',    'Task',     'task',    '#2684FF', TRUE, 3),
    ('bug',     'Bug',      'bug',     '#FF5630', TRUE, 4),
    ('subtask', 'Sub-task', 'subtask', '#2684FF', TRUE, 5);

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_type_check;

CREATE TABLE custom_fields (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL = all spaces
    name       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select')),
    options    JSONB NOT NULL DEFAULT '[]',
    position   INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX custom_fields_global_name_idx ON custom_fields (lower(name)) WHERE project_id IS NULL;
CREATE UNIQUE INDEX custom_fields_project_name_idx ON custom_fields (project_id, lower(name)) WHERE project_id IS NOT NULL;

CREATE TABLE issue_field_values (
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value    JSONB NOT NULL,
    PRIMARY KEY (issue_id, field_id)
);
CREATE INDEX issue_field_values_field_idx ON issue_field_values (field_id);
