DROP TABLE IF EXISTS wiki_attachments;
DROP TABLE IF EXISTS wiki_page_watchers;
DROP TABLE IF EXISTS wiki_comments;
DROP TABLE IF EXISTS wiki_page_versions;
ALTER TABLE wiki_pages DROP COLUMN IF EXISTS version;
