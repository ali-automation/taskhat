ALTER TABLE wiki_pages DROP COLUMN deleted_at;
DROP TABLE wiki_space_categories;
DROP TABLE wiki_space_watchers;
DROP TABLE wiki_space_stars;
ALTER TABLE wiki_spaces DROP COLUMN owner_id;
ALTER TABLE wiki_spaces DROP COLUMN archived_at;
ALTER TABLE wiki_spaces DROP COLUMN icon;
