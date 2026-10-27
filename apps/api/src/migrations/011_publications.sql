ALTER TABLE routines ADD COLUMN IF NOT EXISTS work_type text NOT NULL DEFAULT 'general'
  CHECK (work_type IN ('general', 'ideas', 'content', 'publish', 'conversations', 'strategy'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_type text NOT NULL DEFAULT 'general'
  CHECK (work_type IN ('general', 'ideas', 'content', 'publish', 'conversations', 'strategy'));

UPDATE routines SET work_type = CASE
  WHEN source_artifact_id IS NOT NULL THEN 'content'
  WHEN instructions LIKE '%find-content-ideas skill%' OR instructions LIKE '%work-content-ideas skill%' THEN 'ideas'
  WHEN instructions LIKE '%conversations-to-join skill%' THEN 'conversations'
  WHEN instructions LIKE '%weekly-strategy-research skill%' THEN 'strategy'
  ELSE 'general'
END;

UPDATE tasks t SET work_type = r.work_type
  FROM routine_runs rr JOIN routines r ON r.id = rr.routine_id
  WHERE rr.task_id = t.id;

CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  routine_id uuid UNIQUE REFERENCES routines(id) ON DELETE SET NULL,
  task_id uuid UNIQUE REFERENCES tasks(id) ON DELETE SET NULL,
  platform text,
  publisher text NOT NULL CHECK (publisher IN ('founder', 'agent')),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 25000),
  post_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'due', 'posted', 'skipped')),
  posted_url text CHECK (char_length(posted_url) <= 2048),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS publications_open ON publications(artifact_id)
  WHERE status IN ('scheduled', 'due');

CREATE INDEX IF NOT EXISTS publications_user ON publications(user_id, post_at);
