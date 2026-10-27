-- Plugin catalog: tools and skills grouped into plugins Orca activates per task.
-- Rows are projected from code (src/plugins and src/skills) by the catalog sync in
-- migrate.ts. Skills are folders with a SKILL.md, read from disk by read_skill; the
-- catalog keeps each skill's folder.
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
  dir text NOT NULL,
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
