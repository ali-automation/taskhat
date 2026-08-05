-- Lossy: collapse per-project workflows back onto the shared default.
-- Issue statuses and column mappings are remapped by status name, falling
-- back to the first status of the same category.
DO $$
DECLARE
    proj RECORD;
BEGIN
    FOR proj IN
        SELECT id, workflow_id FROM projects
        WHERE workflow_id <> '00000000-0000-0000-0000-000000000001'
    LOOP
        UPDATE issues i SET status_id = COALESCE(
            (SELECT d.id FROM statuses d
             JOIN statuses o ON o.id = i.status_id
             WHERE d.workflow_id = '00000000-0000-0000-0000-000000000001' AND d.name = o.name),
            (SELECT d.id FROM statuses d
             JOIN statuses o ON o.id = i.status_id
             WHERE d.workflow_id = '00000000-0000-0000-0000-000000000001' AND d.category = o.category
             ORDER BY d.position LIMIT 1))
        WHERE i.project_id = proj.id;

        UPDATE board_column_statuses bcs SET status_id = COALESCE(
            (SELECT d.id FROM statuses d
             JOIN statuses o ON o.id = bcs.status_id
             WHERE d.workflow_id = '00000000-0000-0000-0000-000000000001' AND d.name = o.name),
            (SELECT d.id FROM statuses d
             JOIN statuses o ON o.id = bcs.status_id
             WHERE d.workflow_id = '00000000-0000-0000-0000-000000000001' AND d.category = o.category
             ORDER BY d.position LIMIT 1))
        WHERE bcs.column_id IN (
            SELECT c.id FROM board_columns c
            JOIN boards b ON b.id = c.board_id
            WHERE b.project_id = proj.id);

        UPDATE projects SET workflow_id = '00000000-0000-0000-0000-000000000001' WHERE id = proj.id;
        DELETE FROM workflows WHERE id = proj.workflow_id;
    END LOOP;
END $$;

DROP INDEX IF EXISTS projects_avatar_key_idx;
ALTER TABLE projects
    DROP COLUMN IF EXISTS avatar_key,
    DROP COLUMN IF EXISTS default_assignee_id,
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS notify_prefs;
