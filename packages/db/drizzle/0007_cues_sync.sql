-- Cues are synced to clients: add the table to the `powersync` publication and grant the
-- replication role read access. Each step skips when already done or when the role or publication
-- is absent, so re-running this file is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'cues'
     ) THEN
    ALTER PUBLICATION powersync ADD TABLE cues;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role')
     AND NOT has_table_privilege('powersync_role', 'public.cues', 'SELECT') THEN
    GRANT SELECT ON cues TO powersync_role;
  END IF;
END
$$;
