DROP INDEX IF EXISTS wiki_pages_confluence_idx;
ALTER TABLE wiki_pages DROP COLUMN IF EXISTS confluence_id;
ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_source_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_source_check
    CHECK (source IN ('jira_api', 'jira_csv'));
