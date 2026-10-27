-- Folders on the founder's computer where they build things (code repositories,
-- design files, notes). Orca's desktop file tools may read inside them, and the
-- "Ideas from my work" routine turns recent work there into content ideas. The path
-- is local to the founder's computer; only the desktop app opens it.
CREATE TABLE brand_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 1000),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, path)
);
