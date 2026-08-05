-- Stage 18: dashboards with gadgets, modeled on Jira dashboards.
-- owner_id NULL marks the site default dashboard (admin-managed, visible to all).

CREATE TABLE dashboards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_shared   BOOLEAN NOT NULL DEFAULT FALSE,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dashboards_single_default ON dashboards (is_default) WHERE is_default;
CREATE UNIQUE INDEX dashboards_owner_name ON dashboards (owner_id, name) WHERE owner_id IS NOT NULL;

CREATE TABLE dashboard_gadgets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    gadget_type  TEXT NOT NULL CHECK (gadget_type IN
                 ('text', 'tql_list', 'pie_chart', 'burndown', 'workload', 'activity', 'quick_links')),
    title        TEXT NOT NULL,
    col          INT NOT NULL DEFAULT 0,
    position     INT NOT NULL DEFAULT 0,
    config       JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_gadgets_dash_idx ON dashboard_gadgets (dashboard_id, col, position);

-- Seed the site default dashboard with Jira's classic trio:
-- Introduction, Assigned to Me, Activity Stream.
WITH d AS (
    INSERT INTO dashboards (owner_id, name, description, is_shared, is_default)
    VALUES (NULL, 'Default dashboard',
            'Everyone sees this dashboard. Administrators can change what appears on it.',
            TRUE, TRUE)
    RETURNING id
)
INSERT INTO dashboard_gadgets (dashboard_id, gadget_type, title, col, position, config)
SELECT id, 'text', 'Introduction', 0, 0,
       jsonb_build_object('text',
         E'Welcome to TaskHat!\n\nThis is the default dashboard. It shows the work assigned to you and what your team has been up to. Create your own dashboard from the Dashboards page to track exactly what matters to you.')
FROM d
UNION ALL
SELECT id, 'tql_list', 'Assigned to me', 0, 1,
       jsonb_build_object('tql', 'assignee = currentUser() AND resolution = EMPTY ORDER BY updated DESC')
FROM d
UNION ALL
SELECT id, 'activity', 'Activity stream', 1, 0, '{}'::jsonb
FROM d;
