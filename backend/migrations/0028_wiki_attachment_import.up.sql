-- W8: imported Confluence attachments — provenance for idempotent re-runs,
-- and the public image key when the attachment is rendered inline.
ALTER TABLE wiki_attachments ADD COLUMN confluence_id TEXT;
ALTER TABLE wiki_attachments ADD COLUMN image_key TEXT;
CREATE UNIQUE INDEX wiki_attachments_confluence_idx
    ON wiki_attachments (confluence_id) WHERE confluence_id IS NOT NULL;
