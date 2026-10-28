-- Which default routines (by skill, seeds/default-routines.ts) each link has been
-- given, so defaults added later reach links seeded before them, while one the
-- founder edited or deleted is never created again.
ALTER TABLE brand_profile_links
  ADD COLUMN seeded_routines text[] NOT NULL DEFAULT '{}';

-- Links seeded so far got the defaults that existed then.
UPDATE brand_profile_links SET seeded_routines = CASE
  WHEN kind IN ('x', 'threads', 'linkedin')
    THEN ARRAY['find-content-ideas', 'conversations-to-join', 'weekly-strategy-research']
  ELSE ARRAY['find-content-ideas', 'weekly-strategy-research']
END
WHERE routines_seeded_at IS NOT NULL;
