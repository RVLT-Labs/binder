-- Runs once, when the dev Postgres data directory is first created.
-- Dev-only credentials: the password below also appears in docker-compose.dev.yml.

-- Replication role for PowerSync. SELECT on the replicated tables and the `powersync` publication
-- are created by the drizzle migration 0003_publication, once the tables exist.
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'powersync_dev_password';

-- PowerSync keeps its own bucket storage in a separate database and needs to own it.
CREATE DATABASE powersync_storage OWNER powersync_role;
