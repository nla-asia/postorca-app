ALTER TABLE brand_profiles
  ADD COLUMN topics text NOT NULL DEFAULT '',
  ADD COLUMN onboarding_status text NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'completed'));

ALTER TABLE brand_profiles ADD COLUMN colors jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE brand_profile_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES brand_profiles(user_id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL
);
CREATE INDEX brand_profile_links_user ON brand_profile_links(user_id);

ALTER TABLE brand_profile_links
  ADD COLUMN kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('instagram','facebook','threads','x','linkedin','website','other')),
  ADD COLUMN publishing_method text NOT NULL DEFAULT '',
  ADD COLUMN publishing_instructions text NOT NULL DEFAULT '',
  ADD COLUMN access_status text NOT NULL DEFAULT 'not_granted'
    CHECK (access_status IN ('not_granted','granted'));
