-- W12: space roles + custom templates.

-- Who can use a space when they're not an explicit member:
-- collaborator (everyone edits, the pre-W12 behavior), viewer (read-only), none (private).
ALTER TABLE wiki_spaces ADD COLUMN default_role TEXT NOT NULL DEFAULT 'collaborator'
    CHECK (default_role IN ('collaborator', 'viewer', 'none'));

CREATE TABLE wiki_space_members (
    space_id   UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('admin', 'collaborator', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, user_id)
);

-- Space creators become the first space admins.
INSERT INTO wiki_space_members (space_id, user_id, role)
SELECT s.id, s.created_by, 'admin'
FROM wiki_spaces s
WHERE s.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE wiki_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id    UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon        TEXT NOT NULL DEFAULT '',
    body_doc    JSONB,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wiki_templates_space_name ON wiki_templates (space_id, lower(name));
