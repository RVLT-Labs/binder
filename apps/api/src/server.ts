import { PRESENCE_HEARTBEAT_MS } from '@binder/shared'
import { serve } from '@hono/node-server'
import { PgBoss } from 'pg-boss'
import { type AppDeps, createApp } from './app'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { DiskBlobStore } from './blob/DiskBlobStore'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'
import { PresenceHub } from './presence/hub'
import { createJobQueue } from './processing/queue'
import { sweepPendingReanchors } from './processing/reanchorSweep'
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

// A revision that became ready but whose re-anchoring was never queued (a crash between the two, or
// a failed enqueue) is found again here: once at start, then every five minutes.
const sweepReanchors = () =>
  sweepPendingReanchors({ db, jobs }).catch((err) => console.error('re-anchor sweep failed', err))
await sweepReanchors()
const reanchorSweepTimer = setInterval(() => void sweepReanchors(), 5 * 60 * 1000)

// Presence (spec 3.9) is in memory: one process, one hub. Connections silent for 15 s are swept.
const presence = new PresenceHub()
const deps: AppDeps = { config, db, blobs, auth, jobs, presence }
const app = createApp(deps)
const presenceSweepTimer = setInterval(
  () => presence.sweep(),
  deps.presenceOptions?.sweepMs ?? PRESENCE_HEARTBEAT_MS,
)

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`binder api listening on :${info.port}`)
})
app.injectWebSocket(server)

// In-flight jobs get a moment to finish; anything left is retried by the next worker.
const shutdown = createShutdown({
  closeServer: () => {
    // Timers first, then tell presence clients (1001: going away) so they reconnect to the next process.
    clearInterval(presenceSweepTimer)
    presence.closeAll(1001, 'server shutting down')
    server.close()
  },
  stopQueue: () => {
    clearInterval(reanchorSweepTimer)
    return boss.stop({ graceful: true, timeout: 10_000 })
  },
  endPool: () => pool.end(),
  exit: (code) => process.exit(code),
})
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
