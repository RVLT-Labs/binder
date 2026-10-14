-- Departments are synced read-only to clients: add the table to the `powersync` publication and
-- grant the replication role read access. Each step skips when already done or when the role or
-- publication is absent, so re-running this file is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'departments'
     ) THEN
    ALTER PUBLICATION powersync ADD TABLE departments;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role')
     AND NOT has_table_privilege('powersync_role', 'public.departments', 'SELECT') THEN
    GRANT SELECT ON departments TO powersync_role;
  END IF;
END
$$;
--> statement-breakpoint
-- Shows created before departments existed get the default set (DEFAULT_DEPARTMENTS in
-- @binder/shared, in this order, sort order = index x 10). Written by the system, no change log row.
INSERT INTO departments (id, show_id, code, name, colour, number_format, sort_order, hidden, updated_by)
SELECT gen_random_uuid()::text, s.id, d.code, d.name, d.colour, d.number_format, d.sort_order, false, 'system'
FROM shows s
CROSS JOIN (VALUES
  ('LX', 'Lighting', '#F5A623', 'decimal', 0),
  ('SND', 'Sound', '#4A90E2', 'decimal', 10),
  ('TM', 'TheatreMix', '#9B51E0', 'point', 20),
  ('VID', 'Video', '#2BB0A6', 'decimal', 30),
  ('SM', 'Stage management', '#D0021B', 'decimal', 40),
  ('STG', 'Stage', '#8B572A', 'decimal', 50),
  ('FLY', 'Flys', '#417505', 'decimal', 60)
) AS d(code, name, colour, number_format, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM departments x WHERE x.show_id = s.id);
