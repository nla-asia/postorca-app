-- A content task is one piece of content: plan, then a script the founder approves,
-- then the content. Its files live in a folder in the founder's working folder.
ALTER TABLE tasks ADD COLUMN content_dir text;
ALTER TABLE tasks ADD COLUMN plan_saved_at timestamptz;
ALTER TABLE tasks ADD COLUMN script_saved_at timestamptz;
-- The turn the script was first written in: approval has to come from a later
-- founder message, never from the turn that wrote it.
ALTER TABLE tasks ADD COLUMN script_turn_id uuid;
ALTER TABLE tasks ADD COLUMN script_approved_at timestamptz;
