import { serve } from '@hono/node-server'
import { PgBoss } from 'pg-boss'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { DiskBlobStore } from './blob/DiskBlobStore'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'
import { createJobQueue } from './processing/queue'
import { createShutdown } from './shutdown'

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

// In-flight jobs get a moment to finish; anything left is retried by the next worker.
const shutdown = createShutdown({
  closeServer: () => server.close(),
  stopQueue: () => boss.stop({ graceful: true, timeout: 10_000 }),
  endPool: () => pool.end(),
  exit: (code) => process.exit(code),
})
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
