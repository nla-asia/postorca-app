-- A session stays signed in until logout or a detected copy: a live refresh token
-- has no expiry. Spent tokens keep one, only for how long reuse is detected.
ALTER TABLE refresh_tokens ALTER COLUMN expires_at DROP NOT NULL;
UPDATE refresh_tokens SET expires_at = NULL WHERE used_at IS NULL;
