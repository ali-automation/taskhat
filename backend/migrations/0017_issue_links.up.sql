CREATE TABLE issue_links (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    to_issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    link_type     TEXT NOT NULL CHECK (link_type IN ('blocks', 'relates', 'duplicates')),
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (from_issue_id, to_issue_id, link_type),
    CHECK (from_issue_id <> to_issue_id)
);
CREATE INDEX issue_links_from_idx ON issue_links (from_issue_id);
CREATE INDEX issue_links_to_idx   ON issue_links (to_issue_id);
