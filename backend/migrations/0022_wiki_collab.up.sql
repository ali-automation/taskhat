-- Stage W3: wiki versions, comments, watchers, attachments.

ALTER TABLE wiki_pages ADD COLUMN version INT NOT NULL DEFAULT 1;

CREATE TABLE wiki_page_versions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id    UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    version    INT NOT NULL,
    title      TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '',
    body_doc   JSONB,
    body_text  TEXT NOT NULL DEFAULT '',
    edited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (page_id, version)
);

-- Every existing page becomes version 1 of itself.
INSERT INTO wiki_page_versions (page_id, version, title, icon, body_doc, body_text, edited_by, created_at)
SELECT id, 1, title, icon, body_doc, body_text, COALESCE(updated_by, created_by), updated_at
FROM wiki_pages;

CREATE TABLE wiki_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id    UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    body_doc   JSONB,
    edited_at  TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wiki_comments_page_idx ON wiki_comments (page_id, created_at);

CREATE TABLE wiki_page_watchers (
    page_id    UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, user_id)
);

CREATE TABLE wiki_attachments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id     UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL,
    uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wiki_attachments_page_idx ON wiki_attachments (page_id);
