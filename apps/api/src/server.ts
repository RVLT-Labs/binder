import { serve } from '@hono/node-server'
import { PgBoss } from 'pg-boss'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { DiskBlobStore } from './blob/DiskBlobStore'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'
import { createJobQueue } from './processing/queue'

const config = loadConfig(process.env)
const { db, pool } = await connectAndMigrate(config)
const auth = createAuth({ db, config, sendMail: createMailer(config) })
const blobs = new DiskBlobStore(config.BLOB_ROOT)

// pg-boss migrates its own `pgboss` schema on start; the workers run in this process (spec 3.6).
const boss = new PgBoss({ connectionString: config.DATABASE_URL })
boss.on('error', (err) => console.error('job queue error', err))
await boss.start()
const jobs = createJobQueue(boss, { db, blobs })
await jobs.start()

const app = createApp({ config, db, blobs, auth, jobs })

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`binder api listening on :${info.port}`)
})

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`${signal} received, shutting down`)
  server.close()
  // In-flight jobs get a moment to finish; anything left is retried by the next worker.
  await boss.stop({ graceful: true, timeout: 10_000 })
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
