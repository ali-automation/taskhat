-- Content kinds in the wiki tree: regular pages, whiteboards (canvas JSON in
-- body_doc), and folders (imported Confluence containers, title only).
ALTER TABLE wiki_pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page'
    CHECK (kind IN ('page', 'whiteboard', 'folder'));
