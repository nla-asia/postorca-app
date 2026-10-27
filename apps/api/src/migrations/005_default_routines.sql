-- Default routines are seeded once per social link after onboarding completes,
-- in the founder's own time zone.

-- Set when a link's defaults were created, so editing or deleting them never
-- brings them back. NULL for links that have no defaults (website, other).
ALTER TABLE brand_profile_links ADD COLUMN routines_seeded_at timestamptz;
-- The link a default routine works on. Deleting the link pauses its routines
-- (in the repository, before the delete) and then clears this reference.
ALTER TABLE routines ADD COLUMN link_id uuid
  REFERENCES brand_profile_links(id) ON DELETE SET NULL;
CREATE INDEX routines_link ON routines(link_id) WHERE link_id IS NOT NULL;
