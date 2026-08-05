-- Stage W1: DocHat (Confluence twin) — wiki spaces and hierarchical pages.

CREATE TABLE wiki_spaces (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key          TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    home_page_id UUID, -- set right after the Overview page is created
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wiki_pages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id   UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    parent_id  UUID REFERENCES wiki_pages(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    position   INT NOT NULL DEFAULT 0,
    body_doc   JSONB,
    body_text  TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_pages_tree_idx ON wiki_pages (space_id, parent_id, position);

ALTER TABLE wiki_spaces
    ADD CONSTRAINT wiki_spaces_home_fk
    FOREIGN KEY (home_page_id) REFERENCES wiki_pages(id) ON DELETE SET NULL;
