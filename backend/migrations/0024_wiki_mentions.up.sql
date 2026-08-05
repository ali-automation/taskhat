-- Stage W5: work items mentioned on wiki pages (via smart chips).
CREATE TABLE wiki_issue_mentions (
    page_id  UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, issue_id)
);
CREATE INDEX wiki_issue_mentions_issue_idx ON wiki_issue_mentions (issue_id);
