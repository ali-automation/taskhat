-- W9: inline comments — text-anchored threads with replies and resolution.
ALTER TABLE wiki_comments ADD COLUMN parent_id UUID REFERENCES wiki_comments(id) ON DELETE CASCADE;
ALTER TABLE wiki_comments ADD COLUMN inline_text TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki_comments ADD COLUMN inline_occurrence INT NOT NULL DEFAULT 0;
ALTER TABLE wiki_comments ADD COLUMN resolved_at TIMESTAMPTZ;
ALTER TABLE wiki_comments ADD COLUMN resolved_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX wiki_comments_parent_idx ON wiki_comments (parent_id);
