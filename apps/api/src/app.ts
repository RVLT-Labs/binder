import type { Db } from '@binder/db'
import type { Actor } from '@binder/shared'
import { Hono } from 'hono'
import type { BlobStore } from './blob/BlobStore'
import type { Config } from './config'
import { AppError } from './errors'
import { health } from './routes/health'

export interface AppDeps {
  config: Config
  db: Db
  blobs: BlobStore
}

export type AppEnv = {
  Variables: {
    deps: AppDeps
    user?: { id: string; email: string; name: string }
    actor?: Actor
  }
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.code, message: err.message }, err.status as 400)
    }
    console.error(err.stack ?? err)
    return c.json({ error: 'internal', message: 'Internal server error' }, 500)
  })

  const api = new Hono<AppEnv>()
  api.route('/', health)
  app.route('/api', api)

  return app
}
