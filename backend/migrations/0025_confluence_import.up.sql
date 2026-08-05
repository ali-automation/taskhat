-- Confluence importer: allow the new job source and remember each imported
-- page's Confluence id so re-runs update instead of duplicating.
ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_source_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_source_check
    CHECK (source IN ('jira_api', 'jira_csv', 'confluence_api'));

ALTER TABLE wiki_pages ADD COLUMN confluence_id TEXT;
CREATE UNIQUE INDEX wiki_pages_confluence_idx
    ON wiki_pages (space_id, confluence_id) WHERE confluence_id IS NOT NULL;
