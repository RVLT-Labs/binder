import { mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTestDb } from '@binder/db/testing'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { type AppDeps, type AppEnv, createApp } from '../src/app'
import { createAuth } from '../src/auth/auth'
import type { SendMail } from '../src/auth/mailer'
import { DiskBlobStore } from '../src/blob/DiskBlobStore'
import type { Config } from '../src/config'
import { PresenceHub } from '../src/presence/hub'
import type { JobQueue } from '../src/processing/types'

/** Records enqueued version, page and re-anchor ids instead of processing them. */
export class RecordingJobs implements JobQueue {
  readonly enqueued: string[] = []
  readonly enqueuedPages: string[] = []
  readonly enqueuedReanchors: string[] = []
  async enqueueDocumentProcess(versionId: string): Promise<void> {
    this.enqueued.push(versionId)
  }
  async enqueuePageProcess(pageIds: string[]): Promise<void> {
    this.enqueuedPages.push(...pageIds)
  }
  async enqueueReanchor(versionId: string): Promise<void> {
    this.enqueuedReanchors.push(versionId)
  }
}

/** The Origin header a browser on the app sends; cookie-authenticated unsafe requests need it. */
export const APP_ORIGIN = 'http://localhost:5173'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    BLOB_ROOT: mkdtempSync(join(tmpdir(), 'binder-blobs-')),
    PORT: 3000,
    APP_ORIGIN,
    AUTH_SECRET: 'test-auth-secret-0123456789abcdef',
    POWERSYNC_JWT_SECRET: 'dGVzdC1wb3dlcnN5bmMtc2VjcmV0',
    POWERSYNC_URL: 'http://localhost:8080',
    ALLOW_SIGNUP: false,
    ...overrides,
  }
}

export async function testDeps(
  overrides: Partial<AppDeps> = {},
  sendMail: SendMail = async () => {},
): Promise<AppDeps> {
  const { db } = await getTestDb()
  const config = overrides.config ?? testConfig()
  return {
    config,
    db,
    blobs: new DiskBlobStore(config.BLOB_ROOT),
    auth: createAuth({ db, config, sendMail }),
    jobs: new RecordingJobs(),
    presence: new PresenceHub(),
    ...overrides,
  }
}

export async function createTestApp(overrides: Partial<AppDeps> = {}, sendMail?: SendMail) {
  const deps = await testDeps(overrides, sendMail)
  return { app: createApp(deps), deps }
}

/** Create a user via the auth API, then sign in over HTTP and return the session cookie header. */
export async function createTestUser(
  app: Hono<AppEnv>,
  deps: AppDeps,
  input: { email: string; name: string; password: string },
): Promise<{ id: string; cookie: string }> {
  const { user } = await deps.auth.api.signUpEmail({ body: input })
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: input.email, password: input.password }),
  })
  if (res.status !== 200) throw new Error(`test sign-in failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  return { id: user.id, cookie }
}

/**
 * Serve the app on a real HTTP server (port 0) with WebSocket upgrades wired in, for tests that need
 * a socket. `close` drops every open connection and stops the server.
 */
export async function listen(app: ReturnType<typeof createApp>): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
  app.injectWebSocket(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no port')
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        ;(server as Server).closeAllConnections()
      }),
  }
}
