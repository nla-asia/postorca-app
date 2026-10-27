CREATE TABLE user_connections (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector text NOT NULL CHECK (connector IN ('gmail', 'google_drive')),
  email text NOT NULL,
  tokens bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL,
  PRIMARY KEY (user_id, connector)
);
CREATE TABLE connector_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector text NOT NULL CHECK (connector IN ('gmail', 'google_drive')),
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
