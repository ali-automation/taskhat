-- W17: space identity, stars, watching, categories, archive, and page trash.
ALTER TABLE wiki_spaces ADD COLUMN icon TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki_spaces ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE wiki_spaces ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE wiki_spaces SET owner_id = created_by;

CREATE TABLE wiki_space_stars (
    space_id   UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, user_id)
);

CREATE TABLE wiki_space_watchers (
    space_id   UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, user_id)
);

CREATE TABLE wiki_space_categories (
    space_id UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    PRIMARY KEY (space_id, category)
);

-- Trash: deleting a page becomes recoverable.
ALTER TABLE wiki_pages ADD COLUMN deleted_at TIMESTAMPTZ;
