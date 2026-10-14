import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDb, runMigrations } from '@binder/db'
import type { Config } from './config'

/** Connects and applies pending migrations; shared by the server and the CLI. */
export async function connectAndMigrate(config: Pick<Config, 'DATABASE_URL'>) {
  const handle = createDb(config.DATABASE_URL)
  // In the bundled build the migrations are copied next to this file; in dev use the db package's own.
  const bundled = fileURLToPath(new URL('./drizzle', import.meta.url))
  await runMigrations(handle.db, existsSync(bundled) ? bundled : undefined)
  return handle
}
