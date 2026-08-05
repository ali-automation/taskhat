-- W14: team calendars per wiki space (all-day events with date ranges).
CREATE TABLE wiki_calendar_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id    UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    color       TEXT NOT NULL DEFAULT 'blue',
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE INDEX wiki_calendar_events_space_start ON wiki_calendar_events (space_id, start_date);
