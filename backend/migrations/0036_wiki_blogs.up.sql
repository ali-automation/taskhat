-- W13: blog posts are wiki pages organized by date instead of the tree.
ALTER TABLE wiki_pages DROP CONSTRAINT wiki_pages_kind_check;
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_pages_kind_check
    CHECK (kind IN ('page', 'whiteboard', 'folder', 'blog'));
