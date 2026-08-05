DROP INDEX sprints_board_name_idx;
DROP INDEX issues_jira_idx;
ALTER TABLE users DROP COLUMN jira_account_id;
ALTER TABLE attachments DROP COLUMN jira_id;
ALTER TABLE comments DROP COLUMN jira_id;
DROP TABLE import_jobs;
