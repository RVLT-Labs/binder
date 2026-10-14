import { showMemberships, user } from '@binder/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { createToken, listOrganisations } from '../src/services'
import { librettoBytes, multipart, setupShow } from './documentHelpers'

// The session cookie is SameSite=Lax, which still rides along on POSTs from sibling *.rvlt.app
// hosts. Unsafe cookie-authenticated requests must come from APP_ORIGIN (I1).
const APP = 'http://localhost:5173'
const EVIL = 'https://evil.rvlt.app'

const jsonPost = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

async function errorOf(res: Response) {
  return ((await res.json()) as { error: string }).error
}

describe('cross-site request forgery guard on cookie sessions', () => {
  test('tenancy: adding a member with a foreign Origin is 403; with APP_ORIGIN it succeeds', async () => {
    const { app, deps, owner, outsider, show } = await setupShow()
    const [{ email }] = await deps.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, outsider.id))
    const body = { email, role: 'owner' }
    const path = `/api/shows/${show.id}/members`
    const evil = await app.request(path, jsonPost({ cookie: owner.cookie, origin: EVIL }, body))
    expect(evil.status).toBe(403)
    expect(await errorOf(evil)).toBe('forbidden')
    const memberships = () =>
      deps.db
        .select()
        .from(showMemberships)
        .where(and(eq(showMemberships.showId, show.id), eq(showMemberships.userId, outsider.id)))
    expect(await memberships()).toHaveLength(0)
    const ok = await app.request(path, jsonPost({ cookie: owner.cookie, origin: APP }, body))
    expect(ok.status).toBe(201)
    expect(await memberships()).toHaveLength(1)
  })

  test('tenancy: PATCH with a foreign Origin is 403, with APP_ORIGIN 200', async () => {
    const { app, owner, show } = await setupShow()
    const path = `/api/shows/${show.id}`
    const evil = await app.request(
      path,
      jsonPost({ cookie: owner.cookie, origin: EVIL }, { title: 'Pwned' }, 'PATCH'),
    )
    expect(evil.status).toBe(403)
    const ok = await app.request(
      path,
      jsonPost({ cookie: owner.cookie, origin: APP }, { title: 'Renamed' }, 'PATCH'),
    )
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { show: { title: string } }).show.title).toBe('Renamed')
  })

  test('sync upload with a foreign Origin is 403; with APP_ORIGIN it is applied', async () => {
    const { app, owner, show } = await setupShow()
    const body = {
      batchId: 'dev-1',
      entries: [{ table: 'shows', id: show.id, op: 'PATCH', data: { title: 'Synced' } }],
    }
    const evil = await app.request(
      '/api/sync/upload',
      jsonPost({ cookie: owner.cookie, origin: EVIL }, body),
    )
    expect(evil.status).toBe(403)
    expect(await errorOf(evil)).toBe('forbidden')
    const ok = await app.request(
      '/api/sync/upload',
      jsonPost({ cookie: owner.cookie, origin: APP }, body),
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ applied: 1, rejected: [] })
  })

  test('document upload with a foreign Origin is 403; with APP_ORIGIN it is 201', async () => {
    const { app, editor, show } = await setupShow()
    const path = `/api/shows/${show.id}/documents`
    const fields = { kind: 'libretto', title: 'Book', ocrMode: 'never' }
    const evil = await app.request(path, {
      method: 'POST',
      headers: { cookie: editor.cookie, origin: EVIL },
      body: multipart(fields, { bytes: librettoBytes() }),
    })
    expect(evil.status).toBe(403)
    expect(await errorOf(evil)).toBe('forbidden')
    const ok = await app.request(path, {
      method: 'POST',
      headers: { cookie: editor.cookie, origin: APP },
      body: multipart(fields, { bytes: librettoBytes() }),
    })
    expect(ok.status).toBe(201)
  })

  test('without Origin, Sec-Fetch-Site same-origin is accepted and anything else is 403', async () => {
    const { app, owner, show } = await setupShow()
    const path = `/api/shows/${show.id}`
    const patch = (headers: Record<string, string>) =>
      app.request(path, jsonPost({ cookie: owner.cookie, ...headers }, { title: 'T' }, 'PATCH'))
    expect((await patch({})).status).toBe(403)
    expect((await patch({ 'sec-fetch-site': 'same-site' })).status).toBe(403)
    expect((await patch({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await patch({ 'sec-fetch-site': 'same-origin' })).status).toBe(200)
    // A present Origin decides on its own, whatever Sec-Fetch-Site claims.
    expect((await patch({ origin: EVIL, 'sec-fetch-site': 'same-origin' })).status).toBe(403)
  })

  test('token management (session-only) is guarded too', async () => {
    const { app, deps, owner } = await setupShow()
    const { record } = await createToken(
      deps.db,
      { userId: owner.id, via: 'web', agent: null },
      { name: 't', showScope: '*' },
    )
    const mint = await app.request(
      '/api/me/tokens',
      jsonPost({ cookie: owner.cookie, origin: EVIL }, { name: 'evil', showScope: '*' }),
    )
    expect(mint.status).toBe(403)
    const revoke = await app.request(`/api/me/tokens/${record.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: EVIL },
    })
    expect(revoke.status).toBe(403)
  })

  test('safe methods are not checked', async () => {
    const { app, owner } = await setupShow()
    const res = await app.request('/api/me/shows', {
      headers: { cookie: owner.cookie, origin: EVIL },
    })
    expect(res.status).toBe(200)
  })

  test('a bearer POST without Origin succeeds', async () => {
    const { app, deps, owner } = await setupShow()
    const actor = { userId: owner.id, via: 'web' as const, agent: null }
    const { token } = await createToken(deps.db, actor, { name: 'cli', showScope: '*' })
    const [org] = await listOrganisations(deps.db, actor)
    const res = await app.request(
      `/api/orgs/${org.id}/shows`,
      jsonPost({ authorization: `Bearer ${token}` }, { title: 'From a script' }),
    )
    expect(res.status).toBe(201)
  })
})

describe('JSON routes require a JSON content type', () => {
  test('a text/plain JSON body is 415 on tenancy, tokens and sync', async () => {
    const { app, deps, owner, show } = await setupShow()
    const [org] = await listOrganisations(deps.db, { userId: owner.id, via: 'web', agent: null })
    const cases: Array<[string, string, unknown]> = [
      ['POST', `/api/orgs/${org.id}/shows`, { title: 'x' }],
      ['POST', '/api/orgs', { name: 'x' }],
      ['PATCH', `/api/shows/${show.id}`, { title: 'x' }],
      ['POST', `/api/shows/${show.id}/members`, { email: 'a@x.test', role: 'viewer' }],
      ['POST', '/api/me/tokens', { name: 'x', showScope: '*' }],
      ['POST', '/api/sync/upload', { batchId: 'b', entries: [] }],
    ]
    for (const [method, path, body] of cases) {
      const res = await app.request(path, {
        method,
        headers: { cookie: owner.cookie, origin: APP, 'content-type': 'text/plain' },
        body: JSON.stringify(body),
      })
      expect(res.status, `${method} ${path}`).toBe(415)
      expect(await errorOf(res)).toBe('unsupported_media_type')
    }
  })

  test('application/json with a charset parameter is accepted', async () => {
    const { app, owner, show } = await setupShow()
    const res = await app.request(`/api/shows/${show.id}`, {
      method: 'PATCH',
      headers: {
        cookie: owner.cookie,
        origin: APP,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ title: 'Charset' }),
    })
    expect(res.status).toBe(200)
  })
})
