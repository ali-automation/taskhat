-- Stage W4: page labels and view restrictions.

CREATE TABLE wiki_page_labels (
    page_id UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    label   TEXT NOT NULL,
    PRIMARY KEY (page_id, label)
);
CREATE INDEX wiki_page_labels_label_idx ON wiki_page_labels (label);

-- When rows exist for a page, only the listed users (plus site admins) may
-- view it; restrictions inherit down the page tree, like Confluence.
CREATE TABLE wiki_page_restrictions (
    page_id    UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, user_id)
);
