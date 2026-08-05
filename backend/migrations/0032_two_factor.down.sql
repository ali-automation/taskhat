DROP TABLE IF EXISTS recovery_codes;
ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled_at;
ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;
