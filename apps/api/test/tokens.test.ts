import { createHash } from 'node:crypto'
import { personalAccessTokens } from '@binder/db'
import type { Actor } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'
import type { AppEnv } from '../src/app'
import { requireUser } from '../src/auth/middleware'
import { AppError } from '../src/errors'
import {
  authenticateToken,
  createOrganisation,
  createShow,
  createToken,
  listTokens,
  revokeToken,
  tokenAllowsShow,
} from '../src/services'
import { createTestApp, createTestUser } from './helpers'

let n = 0
const actor = (userId: string): Actor => ({ userId, via: 'web', agent: null })
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

async function setup() {
  const { app, deps } = await createTestApp()
  const i = ++n
  const user = await createTestUser(app, deps, {
    email: `tok${i}@x.test`,
    name: 'Tess',
    password: 'password123',
  })
  const other = await createTestUser(app, deps, {
    email: `tokother${i}@x.test`,
    name: 'Otto',
    password: 'password123',
  })
  return { app, deps, db: deps.db, user, other }
}

const json = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { cookie, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

describe('token services', () => {
  test('created token authenticates and the plain token is never stored', async () => {
    const { db, user } = await setup()
    const { token, record } = await createToken(db, actor(user.id), {
      name: 'cli',
      showScope: '*',
    })
    expect(token).toMatch(/^bnd_[A-Za-z0-9_-]{43}$/)
    const [row] = await db
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.id, record.id))
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(row.tokenHash).not.toBe(token)
    expect(JSON.stringify(row)).not.toContain(token)
    const auth = await authenticateToken(db, token)
    expect(auth).toEqual({ userId: user.id, tokenId: record.id, showScope: '*' })
  })

  test('unknown tokens do not authenticate', async () => {
    const { db } = await setup()
    expect(await authenticateToken(db, 'bnd_nope')).toBeNull()
  })

  test('revoked and expired tokens do not authenticate', async () => {
    const { db, user } = await setup()
    const a = actor(user.id)
    const { token, record } = await createToken(db, a, { name: 'r', showScope: '*' })
    await revokeToken(db, a, { tokenId: record.id })
    expect(await authenticateToken(db, token)).toBeNull()

    const exp = await createToken(db, a, {
      name: 'e',
      showScope: '*',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db
      .update(personalAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(personalAccessTokens.id, exp.record.id))
    expect(await authenticateToken(db, exp.token)).toBeNull()
  })

  test('last_used_at updates at most once per minute', async () => {
    const { db, user } = await setup()
    const { token, record } = await createToken(db, actor(user.id), { name: 'u', showScope: '*' })
    const read = async () =>
      (
        await db.select().from(personalAccessTokens).where(eq(personalAccessTokens.id, record.id))
      )[0].lastUsedAt
    expect(await read()).toBeNull()
    await authenticateToken(db, token)
    const first = await read()
    expect(first).toBeInstanceOf(Date)
    await authenticateToken(db, token)
    expect((await read())?.getTime()).toBe(first?.getTime())
    const old = new Date(Date.now() - 120_000)
    await db
      .update(personalAccessTokens)
      .set({ lastUsedAt: old })
      .where(eq(personalAccessTokens.id, record.id))
    await authenticateToken(db, token)
    expect((await read())?.getTime()).toBeGreaterThan(old.getTime() + 60_000)
  })

  test('list scope must name shows the user belongs to', async () => {
    const { db, user, other } = await setup()
    const [org] = [await createOrganisation(db, actor(other.id), { name: 'O' })]
    const foreign = await createShow(db, actor(other.id), { organisationId: org.id, title: 'F' })
    const o2 = await createOrganisation(db, actor(user.id), { name: 'Mine' })
    const mine = await createShow(db, actor(user.id), { organisationId: o2.id, title: 'M' })
    expect(
      await code(createToken(db, actor(user.id), { name: 'x', showScope: [foreign.id] })),
    ).toBe('invalid')
    expect(await code(createToken(db, actor(user.id), { name: 'x', showScope: [] }))).toBe(
      'invalid',
    )
    const ok = await createToken(db, actor(user.id), { name: 'x', showScope: [mine.id] })
    expect((await authenticateToken(db, ok.token))?.showScope).toEqual([mine.id])
  })

  test('listTokens is scoped to the actor; revoking others tokens is not_found', async () => {
    const { db, user, other } = await setup()
    const mine = await createToken(db, actor(user.id), { name: 'mine', showScope: '*' })
    await createToken(db, actor(other.id), { name: 'theirs', showScope: '*' })
    const list = await listTokens(db, actor(user.id))
    expect(list.map((t) => t.id)).toEqual([mine.record.id])
    expect(list[0]).not.toHaveProperty('tokenHash')
    expect(await code(revokeToken(db, actor(other.id), { tokenId: mine.record.id }))).toBe(
      'not_found',
    )
    expect(await authenticateToken(db, mine.token)).not.toBeNull()
  })

  test('tokenAllowsShow respects a list scope', () => {
    expect(tokenAllowsShow(['a'], 'b')).toBe(false)
    expect(tokenAllowsShow(['a'], 'a')).toBe(true)
    expect(tokenAllowsShow('*', 'b')).toBe(true)
  })
})

describe('token routes and bearer auth', () => {
  test('bearer header sets actor via mcp with user-agent as agent', async () => {
    const { app, db, user } = await setup()
    const { token } = await createToken(db, actor(user.id), { name: 'b', showScope: '*' })
    const res = await app.request('/api/me', {
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'claude-desktop/1' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string; email: string; name: string } }
    expect(body.user).toEqual({
      id: user.id,
      email: expect.stringContaining('@x.test'),
      name: 'Tess',
    })
  })

  test('malformed, unknown, revoked bearer tokens get 401', async () => {
    const { app, db, user } = await setup()
    for (const h of ['Bearer bnd_unknown', 'Bearer garbage', 'Bearer ', 'Basic abc']) {
      const res = await app.request('/api/me', { headers: { authorization: h } })
      expect(res.status, h).toBe(401)
    }
    const { token, record } = await createToken(db, actor(user.id), { name: 'b', showScope: '*' })
    await revokeToken(db, actor(user.id), { tokenId: record.id })
    const res = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })

  test('actor and scope are set from a bearer token', async () => {
    const { deps, db, user } = await setup()
    const probe = new Hono<AppEnv>()
    probe.use('*', async (c, next) => {
      c.set('deps', deps)
      await next()
    })
    probe.get('/probe', requireUser, (c) => c.json({ actor: c.var.actor }))
    const { token } = await createToken(db, actor(user.id), { name: 's', showScope: '*' })
    const res = await probe.request('/probe', {
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'agent/9' },
    })
    expect(await res.json()).toEqual({
      actor: { userId: user.id, via: 'mcp', agent: 'agent/9', showScope: '*' },
    })
  })

  test('create, list, revoke through the API with a session', async () => {
    const { app, user, other } = await setup()
    const res = await app.request(
      '/api/me/tokens',
      json(user.cookie, 'POST', { name: 'laptop', showScope: '*' }),
    )
    expect(res.status).toBe(201)
    const { token, record } = (await res.json()) as {
      token: string
      record: { id: string; name: string }
    }
    expect(token).toMatch(/^bnd_/)
    expect(record).not.toHaveProperty('tokenHash')

    const list = await app.request('/api/me/tokens', { headers: { cookie: user.cookie } })
    const text = await list.text()
    expect(text).not.toContain(token)
    expect(text).not.toContain('tokenHash')
    expect(JSON.parse(text).tokens).toHaveLength(1)

    const bad = await app.request(
      '/api/me/tokens',
      json(user.cookie, 'POST', { name: '', showScope: '*' }),
    )
    expect(bad.status).toBe(400)
    const past = await app.request(
      '/api/me/tokens',
      json(user.cookie, 'POST', {
        name: 'p',
        showScope: '*',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    )
    expect(past.status).toBe(400)

    const del = await app.request(`/api/me/tokens/${record.id}`, json(other.cookie, 'DELETE'))
    expect(del.status).toBe(404)
    const del2 = await app.request(`/api/me/tokens/${record.id}`, json(user.cookie, 'DELETE'))
    expect(del2.status).toBe(200)
    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(401)
  })

  test('a bearer token cannot list, mint, or revoke tokens', async () => {
    const { app, db, user } = await setup()
    const { token, record } = await createToken(db, actor(user.id), { name: 'b', showScope: '*' })
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const calls = [
      ['GET', '/api/me/tokens', undefined],
      ['POST', '/api/me/tokens', JSON.stringify({ name: 'evil', showScope: '*' })],
      ['DELETE', `/api/me/tokens/${record.id}`, undefined],
    ] as const
    for (const [method, path, body] of calls) {
      const res = await app.request(path, { method, headers, body })
      expect(res.status, `${method} ${path}`).toBe(401)
    }
    expect(await listTokens(db, actor(user.id))).toHaveLength(1)
    expect(await authenticateToken(db, token)).not.toBeNull()
  })

  test('every token route rejects a missing session with 401', async () => {
    const { app } = await setup()
    const routes = [
      ['GET', '/api/me/tokens'],
      ['POST', '/api/me/tokens'],
      ['DELETE', '/api/me/tokens/t1'],
    ] as const
    for (const [method, path] of routes) {
      const res = await app.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      })
      expect(res.status, `${method} ${path}`).toBe(401)
      expect(((await res.json()) as { error: string }).error).toBe('unauthenticated')
    }
  })
})

describe('token scope enforcement', () => {
  async function scoped() {
    const { app, deps, db, user } = await setup()
    const a = actor(user.id)
    const org = await createOrganisation(db, a, { name: 'Co' })
    const showA = await createShow(db, a, { organisationId: org.id, title: 'A' })
    const showB = await createShow(db, a, { organisationId: org.id, title: 'B' })
    const mk = async (showScope: '*' | string[]) =>
      `Bearer ${(await createToken(db, a, { name: 't', showScope })).token}`
    const call = (auth: string, method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    return { app, deps, db, user, org, showA, showB, mk, call }
  }

  test('list-scoped token is 403 outside its scope and works inside it', async () => {
    const { showA, showB, mk, call } = await scoped()
    const t = await mk([showA.id])
    expect((await call(t, 'PATCH', `/api/shows/${showB.id}`, { title: 'X' })).status).toBe(403)
    expect(
      (
        await call(t, 'POST', `/api/shows/${showB.id}/members`, {
          email: 'nobody@x.test',
          role: 'viewer',
        })
      ).status,
    ).toBe(403)
    expect((await call(t, 'PATCH', `/api/shows/${showA.id}`, { title: 'Y' })).status).toBe(200)
  })

  test('GET /api/me/shows returns only in-scope shows', async () => {
    const { showA, mk, call } = await scoped()
    const res = await call(await mk([showA.id]), 'GET', '/api/me/shows')
    const body = (await res.json()) as { active: { id: string }[] }
    expect(body.active.map((s) => s.id)).toEqual([showA.id])
  })

  test('list-scoped token cannot create orgs or shows', async () => {
    const { org, showA, mk, call } = await scoped()
    const t = await mk([showA.id])
    expect((await call(t, 'POST', '/api/orgs', { name: 'N' })).status).toBe(403)
    expect((await call(t, 'POST', `/api/orgs/${org.id}/shows`, { title: 'N' })).status).toBe(403)
  })

  test('a "*" token behaves like a session', async () => {
    const { org, showB, mk, call } = await scoped()
    const t = await mk('*')
    expect((await call(t, 'PATCH', `/api/shows/${showB.id}`, { title: 'Z' })).status).toBe(200)
    expect((await call(t, 'POST', `/api/orgs/${org.id}/shows`, { title: 'N' })).status).toBe(201)
    expect((await call(t, 'POST', '/api/orgs', { name: 'N' })).status).toBe(201)
  })

  test('a valid session cookie wins over a malformed bearer header', async () => {
    const { app, user } = await setup()
    const res = await app.request('/api/me', {
      headers: { cookie: user.cookie, authorization: 'Bearer garbage' },
    })
    expect(res.status).toBe(200)
  })
})
