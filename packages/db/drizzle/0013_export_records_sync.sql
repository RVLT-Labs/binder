-- Export records are synced to clients (shared rows to every member, private rows, whose selection
-- includes the exporter's personal layer, only to the exporter, which the sync streams enforce): add
-- the table to the `powersync` publication and grant the replication role read access. Each step
-- skips when already done or when the role or publication is absent, so re-running this file is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'export_records'
     ) THEN
    ALTER PUBLICATION powersync ADD TABLE export_records;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role')
     AND NOT has_table_privilege('powersync_role', 'public.export_records', 'SELECT') THEN
    GRANT SELECT ON export_records TO powersync_role;
  END IF;
END
$$;
