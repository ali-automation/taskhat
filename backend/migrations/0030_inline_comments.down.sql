DROP INDEX IF EXISTS wiki_comments_parent_idx;
ALTER TABLE wiki_comments DROP COLUMN IF EXISTS resolved_by;
ALTER TABLE wiki_comments DROP COLUMN IF EXISTS resolved_at;
ALTER TABLE wiki_comments DROP COLUMN IF EXISTS inline_occurrence;
ALTER TABLE wiki_comments DROP COLUMN IF EXISTS inline_text;
ALTER TABLE wiki_comments DROP COLUMN IF EXISTS parent_id;
