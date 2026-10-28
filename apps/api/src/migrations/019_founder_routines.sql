-- Which founder-wide default routines (FOUNDER_ROUTINES in seeds/default-routines.ts,
-- by skill) each founder has been given: one routine covering all their social
-- accounts, so a founder who edits or deletes it never gets it back.
ALTER TABLE brand_profiles
  ADD COLUMN seeded_routines text[] NOT NULL DEFAULT '{}';

-- Such a routine has no platform; recurring routines no longer need one.
ALTER TABLE routines DROP CONSTRAINT routines_schedule_shape;
ALTER TABLE routines ADD CONSTRAINT routines_schedule_shape CHECK (
  (run_at IS NULL AND time_of_day IS NOT NULL AND days IS NOT NULL)
  OR (run_at IS NOT NULL AND time_of_day IS NULL AND days IS NULL)
);
