# @binder/db

Drizzle schema and migrations for Binder's Postgres database.

## Migration journal

`drizzle/meta/_journal.json` has no entry with `idx` 15 (it goes 14, 16). That is harmless: the
migrator applies migrations ordered by `when` (their timestamp), not by `idx`. Do not "fix" the gap by
renumbering the entries or the matching `.sql` files; databases that have already applied them would
disagree with the journal.
