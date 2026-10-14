import type { Db } from '@binder/db'
import type { Actor } from '@binder/shared'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Auth } from './auth/auth'
import { signUpGuard } from './auth/middleware'
import type { BlobStore } from './blob/BlobStore'
import type { Config } from './config'
import { AppError } from './errors'
import { mcpAuth } from './mcp/auth'
import { createMcpRoutes } from './mcp/server'
import type { JobQueue } from './processing/types'
import { blobs } from './routes/blobs'
import { documents } from './routes/documents'
import { health } from './routes/health'
import { me } from './routes/me'
import { sync } from './routes/sync'
import { tenancy } from './routes/tenancy'
import { tokens } from './routes/tokens'

export interface AppDeps {
  config: Config
  db: Db
  blobs: BlobStore
  auth: Auth
  jobs: JobQueue
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
    if (err instanceof HTTPException) {
      return c.json(
        {
          error: err.status === 413 ? 'payload_too_large' : 'invalid',
          message: err.message || 'Request failed',
        },
        err.status,
      )
    }
    console.error(`${c.req.method} ${c.req.path}`, err.stack ?? err)
    return c.json({ error: 'internal', message: 'Internal server error' }, 500)
  })

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found' }, 404))

  app.use('/api/auth/*', signUpGuard)
  app.all('/api/auth/*', (c) => c.var.deps.auth.handler(c.req.raw))

  const api = new Hono<AppEnv>()
  api.route('/', health)
  api.route('/', me)
  api.route('/', tenancy)
  api.route('/', tokens)
  api.route('/', sync)
  api.route('/', documents)
  app.route('/api', api)
  app.route('/', blobs)

  // Authenticate before the MCP app parses any body.
  app.use('/mcp/*', mcpAuth)
  app.route('/mcp', createMcpRoutes(deps, deps.config))

  return app
}
