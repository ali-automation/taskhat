ALTER TABLE projects
    ADD COLUMN avatar_key          TEXT,
    ADD COLUMN default_assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN archived_at         TIMESTAMPTZ,
    ADD COLUMN notify_prefs        JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX projects_avatar_key_idx ON projects (avatar_key) WHERE avatar_key IS NOT NULL;

-- Give every project its own workflow (cloned from its current shared one) so
-- status edits never leak across spaces. The default workflow stays as the
-- template for new projects.
DO $$
DECLARE
    proj   RECORD;
    st     RECORD;
    new_wf UUID;
    new_st UUID;
BEGIN
    FOR proj IN SELECT id, key, workflow_id FROM projects LOOP
        INSERT INTO workflows (name) VALUES (proj.key || ' workflow') RETURNING id INTO new_wf;
        FOR st IN
            SELECT id, name, category, position FROM statuses
            WHERE workflow_id = proj.workflow_id ORDER BY position
        LOOP
            INSERT INTO statuses (workflow_id, name, category, position)
            VALUES (new_wf, st.name, st.category, st.position)
            RETURNING id INTO new_st;

            UPDATE issues SET status_id = new_st
            WHERE project_id = proj.id AND status_id = st.id;

            UPDATE board_column_statuses bcs SET status_id = new_st
            WHERE bcs.status_id = st.id
              AND bcs.column_id IN (
                  SELECT c.id FROM board_columns c
                  JOIN boards b ON b.id = c.board_id
                  WHERE b.project_id = proj.id);

            INSERT INTO transitions (workflow_id, from_status_id, to_status_id, name)
            VALUES (new_wf, NULL, new_st, st.name);
        END LOOP;
        UPDATE projects SET workflow_id = new_wf WHERE id = proj.id;
    END LOOP;
END $$;
