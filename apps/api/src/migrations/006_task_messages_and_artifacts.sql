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
  kind text NOT NULL CHECK (kind IN ('document', 'screenshot', 'image', 'audio', 'video', 'url', 'idea')),
  title text NOT NULL,
  content text NOT NULL,
  FOREIGN KEY (turn_id, task_id) REFERENCES turns(id, task_id) ON DELETE CASCADE
);
CREATE INDEX artifacts_task_turn ON artifacts(task_id, turn_id);

ALTER TABLE artifacts ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();

-- "Create content" on an idea queues a one-time schedule that names it. One per idea;
-- deleting the idea keeps the schedule and its work.
ALTER TABLE routines ADD COLUMN source_artifact_id uuid
  REFERENCES artifacts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX routines_source_artifact ON routines(source_artifact_id)
  WHERE source_artifact_id IS NOT NULL;
