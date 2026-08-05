-- Stage 26: workflow editor (diagram + text views, transition rules).

-- Diagram coordinates for the workflow editor; NULL means auto-layout.
ALTER TABLE statuses
    ADD COLUMN pos_x DOUBLE PRECISION,
    ADD COLUMN pos_y DOUBLE PRECISION;

-- Jira-style rules attached to a transition:
--   restrict-who   {"users": [uuid...], "roles": ["lead"|"assignee"|"reporter"|"admin"|"member"...]}
--   required-field {"fields": ["description"|"assignee"|"duedate"|"storypoints"...]}
--   auto-assign    {"assignee": "<uuid>" | "actor" | ""}
CREATE TABLE transition_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transition_id UUID NOT NULL REFERENCES transitions(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('restrict-who', 'required-field', 'auto-assign')),
    config        JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transition_rules_transition_idx ON transition_rules (transition_id);
