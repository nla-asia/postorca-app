-- Project chats reuse tasks and turns. Keep the previous general conversation intact.
DROP INDEX one_agent_chat_per_user;
CREATE UNIQUE INDEX one_agent_chat_per_user ON tasks(user_id)
  WHERE kind='chat' AND project_id IS NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX one_agent_chat_per_project ON tasks(user_id, project_id)
  WHERE kind='chat' AND project_id IS NOT NULL;
