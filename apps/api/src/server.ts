import { createDb, runMigrations } from '@binder/db'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { DiskBlobStore } from './blob/DiskBlobStore'
import { loadConfig } from './config'

const config = loadConfig(process.env)
const { db } = createDb(config.DATABASE_URL)
await runMigrations(db)
const app = createApp({ config, db, blobs: new DiskBlobStore(config.BLOB_ROOT) })

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`binder api listening on :${info.port}`)
})
