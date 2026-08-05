CREATE TABLE permission_schemes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX permission_schemes_single_default
    ON permission_schemes (is_default) WHERE is_default;

CREATE TABLE permission_grants (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheme_id    UUID NOT NULL REFERENCES permission_schemes(id) ON DELETE CASCADE,
    permission   TEXT NOT NULL,
    grantee_type TEXT NOT NULL CHECK (grantee_type IN ('role', 'user', 'lead', 'reporter', 'assignee', 'anyone')),
    grantee_id   TEXT
);

-- grantee_id is NULL for lead/reporter/assignee/anyone; COALESCE keeps those unique too.
CREATE UNIQUE INDEX permission_grants_unique
    ON permission_grants (scheme_id, permission, grantee_type, COALESCE(grantee_id, ''));
CREATE INDEX permission_grants_scheme_perm ON permission_grants (scheme_id, permission);

ALTER TABLE projects ADD COLUMN permission_scheme_id UUID REFERENCES permission_schemes(id);

-- Seed the default scheme mirroring the previous fixed admin/member/viewer behavior.
WITH scheme AS (
    INSERT INTO permission_schemes (name, description, is_default)
    VALUES ('Default permission scheme', 'The default scheme: space admins administer, members work, viewers read.', TRUE)
    RETURNING id
)
INSERT INTO permission_grants (scheme_id, permission, grantee_type, grantee_id)
SELECT scheme.id, p.permission, 'role', r.role
FROM scheme,
     unnest(ARRAY[
        'create', 'edit', 'transition', 'delete', 'assign', 'link', 'comment',
        'attach', 'manage-sprints', 'manage-versions', 'log-work'
     ]) AS p(permission),
     unnest(ARRAY['admin', 'member']) AS r(role)
UNION ALL
SELECT scheme.id, p.permission, 'role', 'admin'
FROM scheme,
     unnest(ARRAY['administer', 'comment-edit-all', 'comment-delete-all', 'attach-delete-all']) AS p(permission);

UPDATE projects
SET permission_scheme_id = (SELECT id FROM permission_schemes WHERE is_default);

ALTER TABLE projects ALTER COLUMN permission_scheme_id SET NOT NULL;
