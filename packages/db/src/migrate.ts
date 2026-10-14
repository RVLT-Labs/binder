import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Db } from './client'

const defaultFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

/** `migrationsFolder` is for bundled builds, where the default (relative to this source file) no longer exists. */
export async function runMigrations(
  db: Db,
  migrationsFolder: string = defaultFolder,
): Promise<void> {
  await migrate(db, { migrationsFolder })
}
