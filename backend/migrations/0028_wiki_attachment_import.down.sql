DROP INDEX IF EXISTS wiki_attachments_confluence_idx;
ALTER TABLE wiki_attachments DROP COLUMN IF EXISTS image_key;
ALTER TABLE wiki_attachments DROP COLUMN IF EXISTS confluence_id;
