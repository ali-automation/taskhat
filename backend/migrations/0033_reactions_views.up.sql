-- W11: emoji reactions on pages and comments, page view tracking.
CREATE TABLE wiki_reactions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id    UUID REFERENCES wiki_pages(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES wiki_comments(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((page_id IS NULL) <> (comment_id IS NULL))
);
CREATE UNIQUE INDEX wiki_reactions_page_uniq ON wiki_reactions (page_id, user_id, emoji) WHERE page_id IS NOT NULL;
CREATE UNIQUE INDEX wiki_reactions_comment_uniq ON wiki_reactions (comment_id, user_id, emoji) WHERE comment_id IS NOT NULL;

CREATE TABLE wiki_page_views (
    page_id        UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, user_id)
);
