ALTER TABLE wiki_pages DROP CONSTRAINT wiki_pages_kind_check;
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_pages_kind_check
    CHECK (kind IN ('page', 'whiteboard', 'folder'));
