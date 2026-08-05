DROP TABLE sessions;
ALTER TABLE users
    DROP COLUMN public_name, DROP COLUMN job_title, DROP COLUMN department,
    DROP COLUMN organization, DROP COLUMN location, DROP COLUMN timezone,
    DROP COLUMN theme, DROP COLUMN avatar_key, DROP COLUMN header_key;
