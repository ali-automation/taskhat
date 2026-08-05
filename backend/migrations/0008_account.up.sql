ALTER TABLE users
    ADD COLUMN public_name  TEXT NOT NULL DEFAULT '',
    ADD COLUMN job_title    TEXT NOT NULL DEFAULT '',
    ADD COLUMN department   TEXT NOT NULL DEFAULT '',
    ADD COLUMN organization TEXT NOT NULL DEFAULT '',
    ADD COLUMN location     TEXT NOT NULL DEFAULT '',
    ADD COLUMN timezone     TEXT NOT NULL DEFAULT '',
    ADD COLUMN theme        TEXT NOT NULL DEFAULT '',
    ADD COLUMN avatar_key   TEXT,
    ADD COLUMN header_key   TEXT;

CREATE UNIQUE INDEX users_avatar_key_idx ON users (avatar_key) WHERE avatar_key IS NOT NULL;
CREATE UNIQUE INDEX users_header_key_idx ON users (header_key) WHERE header_key IS NOT NULL;

CREATE TABLE sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip           TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX sessions_user_idx ON sessions (user_id, last_seen_at DESC);
