CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL
);
CREATE TABLE brand_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  voice text NOT NULL DEFAULT ''
);
