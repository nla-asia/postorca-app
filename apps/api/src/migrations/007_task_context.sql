-- Compacted model context: a summary of a task's messages up to through_message_id.
-- The model receives this summary plus the messages after it; the full history
-- stays in messages for the founder.
CREATE TABLE task_context (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  summary text NOT NULL,
  through_message_id bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
