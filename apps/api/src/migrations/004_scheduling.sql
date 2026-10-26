CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chat', 'work', 'onboarding')),
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
CREATE UNIQUE INDEX one_onboarding_per_user ON tasks(user_id) WHERE kind = 'onboarding';

-- Routines: founder-visible recurring agent work. The server scheduler owns execution.
CREATE TABLE routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('X', 'Threads', 'Instagram', 'Facebook', 'LinkedIn')),
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
  CHECK (platform IN ('X', 'Threads', 'Instagram', 'Facebook', 'LinkedIn'));

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

-- One-time Calendar tasks share the routine scheduler and run ledger.
ALTER TABLE routines ADD COLUMN run_at timestamptz;
ALTER TABLE routines ALTER COLUMN time_of_day DROP NOT NULL;
ALTER TABLE routines ALTER COLUMN days DROP NOT NULL;
ALTER TABLE routines ALTER COLUMN platform DROP NOT NULL;
ALTER TABLE routines ADD CONSTRAINT routines_schedule_shape CHECK (
  (run_at IS NULL AND time_of_day IS NOT NULL AND days IS NOT NULL AND platform IS NOT NULL)
  OR (run_at IS NOT NULL AND time_of_day IS NULL AND days IS NULL)
);
