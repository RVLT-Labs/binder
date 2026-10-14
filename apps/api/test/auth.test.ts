import { describe, expect, test } from 'vitest'
import { createTestApp, createTestUser, testConfig } from './helpers'

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
})
