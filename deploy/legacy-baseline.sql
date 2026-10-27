-- Explicit handoff from the previously deployed schema, through migration 019.
-- Run inside the migration transaction/advisory lock. Never reset the database.
DO $$
DECLARE required record;
BEGIN
  IF to_regclass('public.schema_migrations') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE name='001_accounts.sql') THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='001_initial.sql') THEN
    RAISE EXCEPTION 'Unrecognized migration history; refusing legacy adoption';
  END IF;
  IF (SELECT count(*) FROM schema_migrations) <> 19 OR
     EXISTS (SELECT 1 FROM schema_migrations WHERE name NOT IN (
       '001_initial.sql','002_routines.sql','003_brand_onboarding.sql',
       '004_brand_profile_links.sql','005_link_publishing_details.sql','006_plugins.sql',
       '007_task_context.sql','008_once_schedules.sql','009_connectors.sql',
       '010_default_routines.sql','011_linkedin.sql','012_routine_skills.sql',
       '013_idea_artifacts.sql','014_onboarding_task.sql','015_brand_colors.sql',
       '016_skill_folders.sql','017_drop_media_files.sql','018_media_artifacts.sql',
       '019_refresh_tokens.sql'
     )) THEN RAISE EXCEPTION 'Expected the legacy 019 schema; inspect this database before upgrading'; END IF;
  FOR required IN SELECT * FROM (VALUES
    ('users','password_hash'),('users','timezone'),('brand_profiles','colors'),
    ('brand_profiles','onboarding_status'),('brand_profile_links','routines_seeded_at'),
    ('brand_profile_links','publishing_method'),('tasks','active_plugin'),
    ('turns','status'),('messages','content'),('artifacts','created_at'),
    ('routines','source_artifact_id'),('routines','run_at'),('routine_runs','task_id'),
    ('task_context','through_message_id'),('tools','schema'),('skills','dir'),
    ('plugins','code'),('plugin_tools','tool_name'),('plugin_skills','skill_name'),
    ('user_connections','tokens'),('connector_oauth_states','verifier'),
    ('auth_sessions','revoked_at'),('refresh_tokens','token_hash')
  ) AS expected(table_name,column_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
      AND c.table_name=required.table_name AND c.column_name=required.column_name) THEN
      RAISE EXCEPTION 'Missing legacy column %.%; refusing adoption', required.table_name,required.column_name;
    END IF;
  END LOOP;
  IF to_regclass('public.brand_projects') IS NOT NULL OR to_regclass('public.publications') IS NOT NULL
    OR to_regclass('public.api_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected newer tables; inspect the schema before legacy adoption';
  END IF;
  -- Catalog sync already populated dir in the previous deployment.
  ALTER TABLE skills ALTER COLUMN dir SET NOT NULL;
  INSERT INTO schema_migrations(name) VALUES
    ('001_accounts.sql'),('002_account_timezone.sql'),('003_brand_profile.sql'),
    ('004_scheduling.sql'),('005_default_routines.sql'),
    ('006_task_messages_and_artifacts.sql'),('007_task_context.sql'),
    ('008_plugins.sql'),('010_connectors.sql'),('012_auth_sessions.sql')
  ON CONFLICT (name) DO NOTHING;
END $$;
