DROP TABLE issue_field_values;
DROP TABLE custom_fields;
DROP TABLE work_types;
ALTER TABLE issues ADD CONSTRAINT issues_type_check
    CHECK (type IN ('epic', 'story', 'task', 'bug', 'subtask'));
