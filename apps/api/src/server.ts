import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { DiskBlobStore } from './blob/DiskBlobStore'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'
import type { JobQueue } from './processing/types'

const config = loadConfig(process.env)
const { db } = await connectAndMigrate(config)
const auth = createAuth({ db, config, sendMail: createMailer(config) })
// Placeholder until the processing queue is wired in: uploads are stored but stay queued.
const jobs: JobQueue = {
  async enqueueDocumentProcess(versionId) {
    console.warn(`document processing is not configured; version ${versionId} stays queued`)
  },
}
const app = createApp({ config, db, blobs: new DiskBlobStore(config.BLOB_ROOT), auth, jobs })

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`binder api listening on :${info.port}`)
})
