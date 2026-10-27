-- Legacy deployed schema through 019, retained only as an upgrade test fixture.
CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());

-- 001_initial.sql
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
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chat', 'work')),
  title text NOT NULL,
  current_turn_id uuid,
  approved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_user_created ON tasks(user_id, created_at DESC);
CREATE UNIQUE INDEX one_agent_chat_per_user ON tasks(user_id) WHERE kind = 'chat';
CREATE TABLE turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  UNIQUE (id, task_id)
);
CREATE INDEX turns_task ON turns(task_id, started_at);
ALTER TABLE tasks ADD CONSTRAINT current_turn_belongs_to_task
  FOREIGN KEY (current_turn_id, id) REFERENCES turns(id, task_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turn_id uuid NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('user', 'assistant', 'tool_call', 'tool_result')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_turn_order ON messages(turn_id, id);
CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('document', 'screenshot', 'image', 'url')),
  title text NOT NULL,
  content text NOT NULL,
  FOREIGN KEY (turn_id, task_id) REFERENCES turns(id, task_id) ON DELETE CASCADE
);
CREATE INDEX artifacts_task_turn ON artifacts(task_id, turn_id);

INSERT INTO schema_migrations(name) VALUES ('001_initial.sql');

-- 002_routines.sql
-- Routines: founder-visible recurring agent work. The server scheduler owns execution.
CREATE TABLE routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('X', 'Threads', 'Instagram', 'Facebook')),
  title text NOT NULL,
  instructions text NOT NULL,
  time_of_day time NOT NULL,
  -- ISO weekdays: 1 = Monday ... 7 = Sunday.
  days smallint[] NOT NULL CHECK (
    cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  timezone text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  -- NULL while paused. Recomputed after every run and every schedule change.
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active = (next_run_at IS NOT NULL))
);
CREATE INDEX routines_user ON routines(user_id, created_at);
CREATE INDEX routines_due ON routines(next_run_at) WHERE active;

-- Work created by a routine is labelled with its platform for the Inbox.
ALTER TABLE tasks ADD COLUMN platform text
  CHECK (platform IN ('X', 'Threads', 'Instagram', 'Facebook'));

-- One row per execution. The partial unique index makes a scheduled occurrence
-- start at most once, even if two scheduler ticks or processes race.
CREATE TABLE routine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  scheduled_for timestamptz NOT NULL,
  task_id uuid UNIQUE REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX routine_runs_once ON routine_runs(routine_id, scheduled_for)
  WHERE trigger = 'schedule';
CREATE INDEX routine_runs_latest ON routine_runs(routine_id, created_at DESC);

-- Next occurrence strictly after $4, evaluated in the routine's own time zone
-- (DST-aware via AT TIME ZONE).
CREATE FUNCTION routine_next_run(time, smallint[], text, timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT min(candidate) FROM (
    SELECT (day::date + $1) AT TIME ZONE $3 AS candidate
    FROM generate_series(
      ($4 AT TIME ZONE $3)::date,
      ($4 AT TIME ZONE $3)::date + 8,
      interval '1 day'
    ) AS day
    WHERE extract(isodow FROM day)::smallint = ANY($2)
  ) candidates
  WHERE candidate > $4
$$;

INSERT INTO schema_migrations(name) VALUES ('002_routines.sql');

-- 003_brand_onboarding.sql
ALTER TABLE brand_profiles
  ADD COLUMN topics text NOT NULL DEFAULT '',
  ADD COLUMN platforms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN onboarding_status text NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'completed'));

INSERT INTO schema_migrations(name) VALUES ('003_brand_onboarding.sql');

-- 004_brand_profile_links.sql
CREATE TABLE brand_profile_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES brand_profiles(user_id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL
);
CREATE INDEX brand_profile_links_user ON brand_profile_links(user_id);

-- Platform labels never contained account URLs and cannot be converted to links.
ALTER TABLE brand_profiles DROP COLUMN platforms;
-- Let existing conversations ask for real links once; preserve their messages.
UPDATE brand_profiles SET onboarding_status='not_started'
WHERE onboarding_status IN ('completed','in_progress');

INSERT INTO schema_migrations(name) VALUES ('004_brand_profile_links.sql');

-- 005_link_publishing_details.sql
ALTER TABLE brand_profile_links
  ADD COLUMN kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('instagram','facebook','threads','x','website','other')),
  ADD COLUMN publishing_method text NOT NULL DEFAULT '',
  ADD COLUMN publishing_instructions text NOT NULL DEFAULT '',
  ADD COLUMN access_status text NOT NULL DEFAULT 'not_granted'
    CHECK (access_status IN ('not_granted','granted'));

INSERT INTO schema_migrations(name) VALUES ('005_link_publishing_details.sql');

-- 006_plugins.sql
-- Plugin catalog: tools and skills grouped into plugins the agent activates per task.
-- Rows are projected from code (server/plugins) by the catalog sync in migrate.ts.
CREATE TABLE tools (
  name text PRIMARY KEY,
  runs_on text NOT NULL CHECK (runs_on IN ('server', 'desktop')),
  description text NOT NULL,
  schema jsonb NOT NULL,
  timeout_ms integer CHECK (timeout_ms > 0),
  enabled boolean NOT NULL DEFAULT true,
  CHECK (runs_on = 'server' OR timeout_ms IS NOT NULL)
);
CREATE TABLE skills (
  name text PRIMARY KEY,
  description text NOT NULL,
  content text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE plugins (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE plugin_tools (
  plugin_code text NOT NULL REFERENCES plugins(code) ON DELETE CASCADE,
  tool_name text NOT NULL REFERENCES tools(name) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (plugin_code, tool_name)
);
CREATE TABLE plugin_skills (
  plugin_code text NOT NULL REFERENCES plugins(code) ON DELETE CASCADE,
  skill_name text NOT NULL REFERENCES skills(name) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (plugin_code, skill_name)
);
ALTER TABLE tasks
  ADD COLUMN active_plugin text REFERENCES plugins(code) ON DELETE SET NULL;

INSERT INTO schema_migrations(name) VALUES ('006_plugins.sql');

-- 007_task_context.sql
-- Compacted model context: a summary of a task's messages up to through_message_id.
-- The model receives this summary plus the messages after it; the full history
-- stays in messages for the founder.
CREATE TABLE task_context (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  summary text NOT NULL,
  through_message_id bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(name) VALUES ('007_task_context.sql');

-- 008_once_schedules.sql
-- One-time Calendar tasks share the routine scheduler and run ledger.
ALTER TABLE routines ADD COLUMN run_at timestamptz;
ALTER TABLE routines ALTER COLUMN time_of_day DROP NOT NULL;
ALTER TABLE routines ALTER COLUMN days DROP NOT NULL;
ALTER TABLE routines ALTER COLUMN platform DROP NOT NULL;
ALTER TABLE routines ADD CONSTRAINT routines_schedule_shape CHECK (
  (run_at IS NULL AND time_of_day IS NOT NULL AND days IS NOT NULL AND platform IS NOT NULL)
  OR (run_at IS NOT NULL AND time_of_day IS NULL AND days IS NULL)
);

INSERT INTO schema_migrations(name) VALUES ('008_once_schedules.sql');

-- 009_connectors.sql
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

INSERT INTO schema_migrations(name) VALUES ('009_connectors.sql');

-- 010_default_routines.sql
-- Default routines are seeded once per social link after onboarding completes,
-- in the founder's own time zone.
ALTER TABLE users ADD COLUMN timezone text;
-- Set when a link's defaults were created, so editing or deleting them never
-- brings them back. NULL for links that have no defaults (website, other).
ALTER TABLE brand_profile_links ADD COLUMN routines_seeded_at timestamptz;
-- The link a default routine works on. Deleting the link pauses its routines
-- (in the repository, before the delete) and then clears this reference.
ALTER TABLE routines ADD COLUMN link_id uuid
  REFERENCES brand_profile_links(id) ON DELETE SET NULL;
CREATE INDEX routines_link ON routines(link_id) WHERE link_id IS NOT NULL;

INSERT INTO schema_migrations(name) VALUES ('010_default_routines.sql');

-- 011_linkedin.sql
-- LinkedIn joins the supported social platforms for links, routines, and work.
ALTER TABLE brand_profile_links DROP CONSTRAINT brand_profile_links_kind_check;
ALTER TABLE brand_profile_links ADD CONSTRAINT brand_profile_links_kind_check
  CHECK (kind IN ('instagram','facebook','threads','x','linkedin','website','other'));
ALTER TABLE routines DROP CONSTRAINT routines_platform_check;
ALTER TABLE routines ADD CONSTRAINT routines_platform_check
  CHECK (platform IN ('X', 'Threads', 'Instagram', 'Facebook', 'LinkedIn'));
ALTER TABLE tasks DROP CONSTRAINT tasks_platform_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_platform_check
  CHECK (platform IN ('X', 'Threads', 'Instagram', 'Facebook', 'LinkedIn'));

INSERT INTO schema_migrations(name) VALUES ('011_linkedin.sql');

-- 012_routine_skills.sql
-- Default routines now name a core skill (server/skills) instead of carrying the
-- process. Only seeded routines whose instructions still match the original
-- templates are changed; anything the founder edited is left alone.
UPDATE routines r SET instructions = format(
    'Read the %s skill with read_skill, then follow it for %s (%s).',
    CASE r.title
      WHEN 'Content ideas' THEN 'content-ideas'
      WHEN 'Conversations to join' THEN 'conversations-to-join'
      ELSE 'weekly-strategy-research'
    END,
    l.name, l.url)
  FROM brand_profile_links l
  WHERE r.link_id = l.id
    AND ((r.title = 'Content ideas' AND r.instructions LIKE 'Propose five content ideas for %')
      OR (r.title = 'Conversations to join' AND r.instructions LIKE 'Find up to five recent, active conversations %')
      OR (r.title = 'Weekly strategy research' AND r.instructions LIKE 'Research what is working this week %'));

-- "Draft posts for review" is no longer a default: drafting without the founder's
-- direction is not a routine the agent starts on its own. Its Inbox work is kept.
DELETE FROM routines
  WHERE link_id IS NOT NULL
    AND title = 'Draft posts for review'
    AND instructions LIKE 'Draft three ready-to-post pieces for %';

INSERT INTO schema_migrations(name) VALUES ('012_routine_skills.sql');

-- 013_idea_artifacts.sql
-- Content ideas are delivered one per artifact, so the founder can turn a single idea
-- into content work.
ALTER TABLE artifacts DROP CONSTRAINT artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check
  CHECK (kind IN ('document', 'screenshot', 'image', 'url', 'idea'));
-- Artifacts are shown in the order they were made (ids are random).
ALTER TABLE artifacts ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();

-- "Create content" on an idea queues a one-time schedule that names it. One per idea;
-- deleting the idea keeps the schedule and its work.
ALTER TABLE routines ADD COLUMN source_artifact_id uuid
  REFERENCES artifacts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX routines_source_artifact ON routines(source_artifact_id)
  WHERE source_artifact_id IS NOT NULL;

-- The ideas routine follows the find-content-ideas skill (renamed from content-ideas).
UPDATE routines SET instructions = replace(instructions,
    'Read the content-ideas skill', 'Read the find-content-ideas skill')
  WHERE link_id IS NOT NULL AND instructions LIKE 'Read the content-ideas skill%';

INSERT INTO schema_migrations(name) VALUES ('013_idea_artifacts.sql');

-- 014_onboarding_task.sql
-- Onboarding is its own conversation, so Agent chat does not start with the setup
-- questions. One per founder, like Agent chat.
ALTER TABLE tasks DROP CONSTRAINT tasks_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check
  CHECK (kind IN ('chat', 'work', 'onboarding'));
CREATE UNIQUE INDEX one_onboarding_per_user ON tasks(user_id) WHERE kind = 'onboarding';

INSERT INTO schema_migrations(name) VALUES ('014_onboarding_task.sql');

-- 015_brand_colors.sql
-- The founder's brand colours, applied to every video so they look like one brand:
-- {background, text, highlight} as #RRGGBB, each optional. Empty means not set.
ALTER TABLE brand_profiles ADD COLUMN colors jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO schema_migrations(name) VALUES ('015_brand_colors.sql');

-- 016_skill_folders.sql
-- Skills are folders with a SKILL.md (Agent Skills format), read from disk by
-- read_skill. The catalog keeps each skill's folder instead of a copy of its text.
ALTER TABLE skills ADD COLUMN dir text;
ALTER TABLE skills DROP COLUMN content;

INSERT INTO schema_migrations(name) VALUES ('016_skill_folders.sql');

-- 017_drop_media_files.sql
-- An earlier 017 added a media_files table for a sample music library; music is now
-- imported when it's used, like narration audio, so the table goes.
DROP TABLE IF EXISTS media_files;

INSERT INTO schema_migrations(name) VALUES ('017_drop_media_files.sql');

-- 018_media_artifacts.sql
ALTER TABLE artifacts DROP CONSTRAINT artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check
  CHECK (kind IN ('document', 'screenshot', 'image', 'audio', 'video', 'url', 'idea'));

INSERT INTO schema_migrations(name) VALUES ('018_media_artifacts.sql');

-- 019_refresh_tokens.sql
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

INSERT INTO schema_migrations(name) VALUES ('019_refresh_tokens.sql');
