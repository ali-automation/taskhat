ALTER TABLE users
    ADD COLUMN language     TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN landing_page TEXT NOT NULL DEFAULT 'your-work',
    ADD COLUMN notify_prefs JSONB NOT NULL DEFAULT '{}';
