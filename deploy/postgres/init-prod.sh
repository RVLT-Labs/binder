#!/bin/sh
# Runs once, when the Postgres data directory is first created (the official image's init hook).
# Creates the PowerSync replication role and its bucket-storage database. The role's password comes
# from POWERSYNC_DB_PASSWORD. SELECT on the replicated tables and the `powersync` publication are
# created later by the drizzle migration 0003_publication, which needs this role to exist first.
#
# Idempotent: every step creates only what is missing and re-applies the rest, so a partial failure
# is recovered by running it again against the running container (see README.md):
#   docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-powersync.sh
set -eu

: "${POWERSYNC_DB_PASSWORD:?POWERSYNC_DB_PASSWORD must be set}"

# The password is passed as a psql variable and quoted with :'pw' / %L, never spliced into SQL text.
# \gexec runs each generated statement on its own, which CREATE DATABASE requires.
psql -v ON_ERROR_STOP=1 -v pw="$POWERSYNC_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname postgres <<'SQL'
SELECT 'CREATE ROLE powersync_role LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'powersync_role') \gexec
SELECT format('ALTER ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD %L', :'pw') \gexec

-- PowerSync keeps its own bucket storage in a separate database and needs to own it.
SELECT 'CREATE DATABASE powersync_storage OWNER powersync_role'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'powersync_storage') \gexec
ALTER DATABASE powersync_storage OWNER TO powersync_role;
GRANT CREATE ON DATABASE powersync_storage TO powersync_role;
SQL
