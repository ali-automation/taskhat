-- W16: page stars + page archiving.
CREATE TABLE wiki_page_stars (
    page_id    UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, user_id)
);

ALTER TABLE wiki_pages ADD COLUMN archived_at TIMESTAMPTZ;
