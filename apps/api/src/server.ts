import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { DiskBlobStore } from './blob/DiskBlobStore'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'

const config = loadConfig(process.env)
const { db } = await connectAndMigrate(config)
const auth = createAuth({ db, config, sendMail: createMailer(config) })
const app = createApp({ config, db, blobs: new DiskBlobStore(config.BLOB_ROOT), auth })

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`binder api listening on :${info.port}`)
})
