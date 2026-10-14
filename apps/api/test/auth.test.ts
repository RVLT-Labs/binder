import { session as sessionTable, user as userTable } from '@binder/db'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { createAuth } from '../src/auth/auth'
import type { MailMessage } from '../src/auth/mailer'
import { createTestApp, createTestUser, testConfig, testDeps } from './helpers'

const signUp = (app: Awaited<ReturnType<typeof createTestApp>>['app'], email: string) =>
  app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name: 'A', password: 'password123' }),
  })

describe('auth', () => {
  test('sign in sets a session cookie and /api/me returns the user', async () => {
    const { app, deps } = await createTestApp()
    const u = await createTestUser(app, deps, {
      email: 'j@x.test',
      name: 'Jayden',
      password: 'correct horse',
    })
    const me = await app.request('/api/me', { headers: { cookie: u.cookie } })
    expect(me.status).toBe(200)
    const body = (await me.json()) as { user: unknown }
    expect(body.user).toEqual({ id: u.id, email: 'j@x.test', name: 'Jayden' })
  })

  test('/api/me without a cookie is 401 in the JSON error shape', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/me')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'unauthenticated',
      message: 'Authentication required',
    })
  })

  test('public sign-up is refused', async () => {
    const { app } = await createTestApp()
    const res = await signUp(app, 'a@x.test')
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('forbidden')
  })

  test('sign-up works when ALLOW_SIGNUP is true', async () => {
    const { app } = await createTestApp({ config: testConfig({ ALLOW_SIGNUP: true }) })
    const res = await signUp(app, 'b@x.test')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe('b@x.test')
  })

  test('user ids are UUIDv7', async () => {
    const { app, deps } = await createTestApp()
    const u = await createTestUser(app, deps, {
      email: 'id@x.test',
      name: 'I',
      password: 'password123',
    })
    expect(u.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  describe('magic link', () => {
    async function requestLink(
      app: Awaited<ReturnType<typeof createTestApp>>['app'],
      email: string,
    ) {
      return app.request('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name: 'M' }),
      })
    }
    const linkFrom = (mails: MailMessage[]) => {
      const m = mails.at(-1)?.text.match(/https?:\/\/\S+/)
      return m ? new URL(m[0]) : undefined
    }

    test('does not create an account for an unknown email when sign-up is closed', async () => {
      const mails: MailMessage[] = []
      const { app, deps } = await createTestApp({}, async (m) => void mails.push(m))
      const sessionsBefore = (await deps.db.select().from(sessionTable)).length
      await requestLink(app, 'new@x.test')
      const url = linkFrom(mails)
      if (url) {
        const res = await app.request(url.pathname + url.search, { redirect: 'manual' })
        expect(res.headers.getSetCookie().join(';')).not.toContain('session_token')
      }
      expect(
        await deps.db.select().from(userTable).where(eq(userTable.email, 'new@x.test')),
      ).toHaveLength(0)
      expect(await deps.db.select().from(sessionTable)).toHaveLength(sessionsBefore)
    })

    test('signs in an existing user', async () => {
      const mails: MailMessage[] = []
      const { app, deps } = await createTestApp({}, async (m) => void mails.push(m))
      const u = await createTestUser(app, deps, {
        email: 'ml@x.test',
        name: 'ML',
        password: 'password123',
      })
      expect((await requestLink(app, 'ml@x.test')).status).toBe(200)
      const url = linkFrom(mails)
      expect(url).toBeDefined()
      const res = await app.request((url as URL).pathname + (url as URL).search, {
        redirect: 'manual',
      })
      const cookie = res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ')
      expect(cookie).toContain('session_token')
      const me = await app.request('/api/me', { headers: { cookie } })
      expect(me.status).toBe(200)
      expect(((await me.json()) as { user: { id: string } }).user.id).toBe(u.id)
    })
  })

  describe('rate limiting', () => {
    async function limitedApp() {
      const deps = await testDeps()
      deps.auth = createAuth({
        db: deps.db,
        config: deps.config,
        sendMail: async () => {},
        rateLimit: { enabled: true },
      })
      return createApp(deps)
    }
    const badSignIn = (app: ReturnType<typeof createApp>, headers: Record<string, string>) =>
      app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ email: 'nobody@x.test', password: 'wrong password' }),
      })
    const statuses = async (
      app: ReturnType<typeof createApp>,
      headers: Record<string, string>,
      n: number,
    ) => {
      const out: number[] = []
      for (let i = 0; i < n; i++) out.push((await badSignIn(app, headers)).status)
      return out
    }

    test('clients are limited independently by cf-connecting-ip', async () => {
      const app = await limitedApp()
      // Behind the proxies every request shares one X-Forwarded-For tail; only the client differs.
      const via = (ip: string) => ({ 'cf-connecting-ip': ip, 'x-forwarded-for': '10.1.2.3' })
      const a = await statuses(app, via('203.0.113.10'), 6)
      expect(a).toContain(429)
      expect(a[0]).not.toBe(429)
      // A different client is untouched by the first one's failures.
      expect((await badSignIn(app, via('203.0.113.11'))).status).not.toBe(429)
      // The first client is still locked out.
      expect((await badSignIn(app, via('203.0.113.10'))).status).toBe(429)
    })

    test('without cf-connecting-ip, the client is the last non-private x-forwarded-for entry', async () => {
      const app = await limitedApp()
      const via = (ip: string) => ({ 'x-forwarded-for': `${ip}, 10.9.8.7` })
      expect(await statuses(app, via('198.51.100.20'), 6)).toContain(429)
      expect((await badSignIn(app, via('198.51.100.21'))).status).not.toBe(429)
    })
  })
})
