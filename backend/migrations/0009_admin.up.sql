ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- No seed admin: the first active account on a fresh site becomes the
-- site admin at registration time (see store.CreateUser).

CREATE TABLE invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       CITEXT NOT NULL,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE, -- claim/reset target
    token       TEXT NOT NULL UNIQUE,
    invited_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ
);

CREATE INDEX invites_email_idx ON invites (email);

CREATE TABLE site_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_settings (key, value) VALUES
    ('site_name', 'TaskHat'),
    ('registration_mode', 'open'),
    ('smtp_addr', ''),
    ('smtp_from', '');
