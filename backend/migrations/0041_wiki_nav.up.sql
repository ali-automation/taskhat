-- W19: space shortcuts + personal spaces.
CREATE TABLE wiki_space_shortcuts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id   UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    url        TEXT NOT NULL,
    position   INT NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE wiki_spaces ADD COLUMN is_personal BOOLEAN NOT NULL DEFAULT FALSE;
