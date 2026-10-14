import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDb, runMigrations } from '@binder/db'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { DiskBlobStore } from './blob/DiskBlobStore'
import { loadConfig } from './config'

const config = loadConfig(process.env)
const { db } = createDb(config.DATABASE_URL)
// In the bundled build the migrations are copied next to this file; in dev use the db package's own.
const bundled = fileURLToPath(new URL('./drizzle', import.meta.url))
await runMigrations(db, existsSync(bundled) ? bundled : undefined)
const app = createApp({ config, db, blobs: new DiskBlobStore(config.BLOB_ROOT) })

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`binder api listening on :${info.port}`)
})
