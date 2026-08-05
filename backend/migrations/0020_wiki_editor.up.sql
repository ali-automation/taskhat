-- Stage W2: editor parity — inline images and autosaved drafts.

-- Editor images, served like avatars: public unguessable UUID keys.
CREATE TABLE wiki_images (
    key         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mime        TEXT NOT NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One draft per (user, page); page_id NULL = a draft for a brand-new page.
CREATE TABLE wiki_drafts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id    UUID REFERENCES wiki_pages(id) ON DELETE CASCADE,
    space_id   UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    parent_id  UUID REFERENCES wiki_pages(id) ON DELETE SET NULL,
    title      TEXT NOT NULL DEFAULT '',
    body_doc   JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wiki_drafts_page_unique ON wiki_drafts (user_id, page_id) WHERE page_id IS NOT NULL;
CREATE INDEX wiki_drafts_user_idx ON wiki_drafts (user_id, space_id);
