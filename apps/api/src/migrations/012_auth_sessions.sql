-- A signed-in client (one login on one app) and its rotating refresh tokens.
-- Each refresh spends the presented token and issues the next; presenting a spent
-- token again outside a short grace window means it was copied, so the whole
-- session is revoked.
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE refresh_tokens (
  -- SHA-256 of the token; the token itself is never stored.
  token_hash bytea PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX refresh_tokens_session ON refresh_tokens(session_id);
