-- Import fidelity: idempotent worklog import needs Jira provenance.
ALTER TABLE worklogs ADD COLUMN jira_id TEXT;
CREATE UNIQUE INDEX worklogs_jira_idx ON worklogs (jira_id) WHERE jira_id IS NOT NULL;
