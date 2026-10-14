#!/bin/sh
# Runs once, when the Postgres data directory is first created (the official image's init hook).
# Creates the PowerSync replication role and its bucket-storage database. The role's password comes
# from POWERSYNC_DB_PASSWORD. SELECT on the replicated tables and the `powersync` publication are
# created later by the drizzle migration 0003_publication, which needs this role to exist first.
set -eu

: "${POWERSYNC_DB_PASSWORD:?POWERSYNC_DB_PASSWORD must be set}"

# The password is passed as a psql variable and quoted with :'pw', never spliced into the SQL text.
psql -v ON_ERROR_STOP=1 -v pw="$POWERSYNC_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD :'pw';
-- PowerSync keeps its own bucket storage in a separate database and needs to own it.
CREATE DATABASE powersync_storage OWNER powersync_role;
GRANT CREATE ON DATABASE powersync_storage TO powersync_role;
SQL
