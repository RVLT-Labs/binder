import { PowerSyncDatabase, WASQLiteVFS } from '@powersync/web'
import { AppSchema } from './schema'

/** The browser's local SQLite (wa-sqlite on OPFS in a dedicated worker), mirrored by PowerSync. */
export function createPowerSync(): PowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: 'binder.sqlite', vfs: WASQLiteVFS.OPFSCoopSyncVFS },
  })
}
