ALTER TABLE users
    DROP COLUMN IF EXISTS language,
    DROP COLUMN IF EXISTS landing_page,
    DROP COLUMN IF EXISTS notify_prefs;
