import type { Db } from '@binder/db'
import { type Actor, PRESENCE_MAX_FRAME_BYTES } from '@binder/shared'
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws'
import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import type { Auth } from './auth/auth'
import { signUpGuard } from './auth/middleware'
import type { BlobStore } from './blob/BlobStore'
import type { Config } from './config'
import { AppError } from './errors'
import { mcpAuth } from './mcp/auth'
import { createMcpRoutes } from './mcp/server'
import type { PresenceHub } from './presence/hub'
import type { JobQueue } from './processing/types'
import { blobs } from './routes/blobs'
import { departments } from './routes/departments'
import { documents } from './routes/documents'
import { exportRoutes } from './routes/exports'
import { health } from './routes/health'
import { history } from './routes/history'
import { homePulse } from './routes/homePulse'
import { me } from './routes/me'
import { createPresenceRoutes } from './routes/presence'
import { revisions } from './routes/revisions'
import { sync } from './routes/sync'
import { tenancy } from './routes/tenancy'
import { tokens } from './routes/tokens'

export interface AppDeps {
  config: Config
  db: Db
  blobs: BlobStore
  auth: Auth
  jobs: JobQueue
  presence: PresenceHub
  /** How often silent connections are swept (read by server.ts) and sessions and memberships re-read; tests shorten them. */
  presenceOptions?: { sweepMs?: number; recheckMs?: number }
}

export type AppEnv = {
  Variables: {
    deps: AppDeps
    user?: { id: string; email: string; name: string }
    actor?: Actor
  }
}

/** The app, plus the hook that lets its HTTP server take WebSocket upgrades (presence). */
export type BinderApp = Hono<AppEnv> & { injectWebSocket: NodeWebSocket['injectWebSocket'] }

export function createApp(deps: AppDeps): BinderApp {
  const app = new Hono<AppEnv>()
  const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({ app })
  // The library closes a socket that sends a larger frame with 1009 before our handler sees it.
  wss.options.maxPayload = PRESENCE_MAX_FRAME_BYTES

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

  // JSON bodies are small; only the PDF upload routes (which enforce their own 200 MB limit while
  // streaming) take large ones. Applies to the unauthenticated auth endpoints and MCP too.
  app.use('/api/*', jsonBodyLimit)
  app.use('/mcp', jsonBodyLimit)
  app.use('/mcp/*', jsonBodyLimit)

  app.use('/api/auth/*', signUpGuard)
  app.all('/api/auth/*', (c) => c.var.deps.auth.handler(c.req.raw))

  const api = new Hono<AppEnv>()
  api.route('/', health)
  api.route('/', me)
  api.route('/', homePulse)
  api.route('/', tenancy)
  api.route('/', departments)
  api.route('/', tokens)
  api.route('/', sync)
  api.route('/', documents)
  api.route('/', history)
  api.route('/', exportRoutes)
  api.route('/', revisions)
  api.route('/', createPresenceRoutes(upgradeWebSocket))
  app.route('/api', api)
  app.route('/', blobs)

  // Authenticate before the MCP app parses any body.
  app.use('/mcp/*', mcpAuth)
  app.route('/mcp', createMcpRoutes(deps, deps.config))

  return Object.assign(app, { injectWebSocket })
}

export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024

/** The multipart uploads: documents, document versions and exports. */
const UPLOAD_PATH = /^\/api\/shows\/[^/]+\/(?:documents(?:\/[^/]+\/versions)?|exports)\/?$/

const limit = bodyLimit({ maxSize: MAX_JSON_BODY_BYTES })

const jsonBodyLimit: MiddlewareHandler<AppEnv> = (c, next) =>
  c.req.method === 'POST' && UPLOAD_PATH.test(c.req.path) ? next() : limit(c, next)
