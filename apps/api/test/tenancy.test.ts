import { changeLog, showMemberships } from '@binder/db'
import type { Actor } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import {
  addShowMember,
  assertShowWritable,
  createOrganisation,
  createShow,
  listOrganisations,
  listShows,
  updateShow,
} from '../src/services'
import { APP_ORIGIN, createTestApp, createTestUser } from './helpers'

let n = 0
const em = (k: string, i: number) => `${k}${i}@x.test`
const actor = (userId: string): Actor => ({ userId, via: 'web', agent: null })
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

async function setup() {
  const { app, deps } = await createTestApp()
  const i = ++n
  const mail = { o: em('o', i), e: em('e', i), v: em('v', i), n: em('n', i), s: em('s', i) }
  const owner = await createTestUser(app, deps, {
    email: mail.o,
    name: 'Olive',
    password: 'password123',
  })
  const editor = await createTestUser(app, deps, {
    email: mail.e,
    name: 'Ed',
    password: 'password123',
  })
  const viewer = await createTestUser(app, deps, {
    email: mail.v,
    name: 'Vi',
    password: 'password123',
  })
  const [org] = await listOrganisations(deps.db, actor(owner.id))
  const show = await createShow(deps.db, actor(owner.id), { organisationId: org.id, title: 'A' })
  await addShowMember(deps.db, actor(owner.id), {
    showId: show.id,
    email: mail.e,
    role: 'editor',
  })
  await addShowMember(deps.db, actor(owner.id), {
    showId: show.id,
    email: mail.v,
    role: 'viewer',
  })
  return { mail, app, deps, db: deps.db, owner, editor, viewer, org, show }
}

describe('tenancy services', () => {
  test('a new user gets a personal organisation', async () => {
    const { app, deps } = await createTestApp()
    const u = await createTestUser(app, deps, {
      email: `p${++n}@x.test`,
      name: 'Pat',
      password: 'password123',
    })
    const orgs = await listOrganisations(deps.db, actor(u.id))
    expect(orgs).toHaveLength(1)
    expect(orgs[0].name).toBe("Pat's organisation")
  })

  test('createOrganisation makes the creator an owner member', async () => {
    const { app, deps } = await createTestApp()
    const u = await createTestUser(app, deps, {
      email: `c${++n}@x.test`,
      name: 'C',
      password: 'password123',
    })
    await createOrganisation(deps.db, actor(u.id), { name: 'Second' })
    expect((await listOrganisations(deps.db, actor(u.id))).map((o) => o.name)).toContain('Second')
  })

  test('createShow requires org membership', async () => {
    const { db, editor, org } = await setup()
    expect(
      await code(createShow(db, actor(editor.id), { organisationId: org.id, title: 'X' })),
    ).toBe('not_found')
  })

  test('createShow logs the show and the owner membership in one batch', async () => {
    const { db, owner, show } = await setup()
    const rows = await db
      .select()
      .from(changeLog)
      .where(eq(changeLog.showId, show.id))
      .orderBy(changeLog.seq)
    const showRow = rows.find((r) => r.tableName === 'shows')
    const memRow = rows.find(
      (r) => r.tableName === 'show_memberships' && r.after?.userId === owner.id,
    )
    if (!showRow || !memRow) throw new Error('missing change log rows')
    expect(memRow).toMatchObject({ tableName: 'show_memberships', op: 'insert', before: null })
    expect(memRow.after).toMatchObject({ userId: owner.id, role: 'owner', departments: ['*'] })
    expect(memRow.batchId).toBe(showRow.batchId)
    expect(showRow.batchId).toBeTruthy()
    const [m] = await db.select().from(showMemberships).where(eq(showMemberships.userId, owner.id))
    expect(m.updatedBy).toBe(owner.id)
    expect(m.updatedAt).toBeInstanceOf(Date)
  })

  test('createShow logs an insert change', async () => {
    const { db, show } = await setup()
    const rows = await db.select().from(changeLog).where(eq(changeLog.rowId, show.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tableName: 'shows',
      op: 'insert',
      showId: show.id,
      before: null,
    })
  })

  test('owner can rename and archive, editor cannot', async () => {
    const { db, owner, editor, show } = await setup()
    const renamed = await updateShow(db, actor(owner.id), {
      showId: show.id,
      patch: { title: 'B' },
    })
    expect(renamed.title).toBe('B')
    const archived = await updateShow(db, actor(owner.id), {
      showId: show.id,
      patch: { status: 'archived' },
    })
    expect(archived.status).toBe('archived')
    expect(
      await code(updateShow(db, actor(editor.id), { showId: show.id, patch: { title: 'C' } })),
    ).toBe('forbidden')
  })

  test('non-members get not_found', async () => {
    const { mail, app, deps, show } = await setup()
    const stranger = await createTestUser(app, deps, {
      email: mail.s,
      name: 'S',
      password: 'password123',
    })
    expect(
      await code(
        updateShow(deps.db, actor(stranger.id), { showId: show.id, patch: { title: 'Z' } }),
      ),
    ).toBe('not_found')
  })

  test('listShows splits archived from active and attaches role', async () => {
    const { db, owner, editor, org, show } = await setup()
    const second = await createShow(db, actor(owner.id), { organisationId: org.id, title: 'Old' })
    await updateShow(db, actor(owner.id), { showId: second.id, patch: { status: 'archived' } })
    const res = await listShows(db, actor(owner.id))
    expect(res.active.map((s) => s.id)).toEqual([show.id])
    expect(res.archived.map((s) => s.id)).toEqual([second.id])
    expect(res.active[0].role).toBe('owner')
    expect((await listShows(db, actor(editor.id))).active[0].role).toBe('editor')
  })

  test('addShowMember by editor is forbidden; unknown email is not_found', async () => {
    const { mail, db, owner, editor, show } = await setup()
    expect(
      await code(
        addShowMember(db, actor(editor.id), { showId: show.id, email: mail.v, role: 'viewer' }),
      ),
    ).toBe('forbidden')
    expect(
      await code(
        addShowMember(db, actor(owner.id), {
          showId: show.id,
          email: 'nobody@x.test',
          role: 'viewer',
        }),
      ),
    ).toBe('not_found')
    expect(
      await code(
        addShowMember(db, actor(owner.id), { showId: show.id, email: mail.v, role: 'viewer' }),
      ),
    ).toBe('conflict')
  })

  test('addShowMember defaults departments to * and logs an insert', async () => {
    const { mail, app, deps, owner, show } = await setup()
    await createTestUser(app, deps, { email: mail.n, name: 'N', password: 'password123' })
    const m = await addShowMember(deps.db, actor(owner.id), {
      showId: show.id,
      email: mail.n.toUpperCase(),
      role: 'editor',
    })
    expect(m.departments).toEqual(['*'])
    expect(m.updatedBy).toBe(owner.id)
    const [row] = await deps.db.select().from(changeLog).where(eq(changeLog.rowId, m.id))
    expect(row).toMatchObject({ tableName: 'show_memberships', op: 'insert', showId: show.id })
  })

  test('updateShow writes a change log row with only changed columns', async () => {
    const { db, owner, show } = await setup()
    await updateShow(db, actor(owner.id), {
      showId: show.id,
      patch: { title: 'B', status: 'prep' },
      batchId: 'batch-1',
    })
    const [row] = await db
      .select()
      .from(changeLog)
      .where(eq(changeLog.rowId, show.id))
      .orderBy(changeLog.seq)
      .offset(1)
    expect(row).toMatchObject({
      tableName: 'shows',
      op: 'update',
      before: { title: 'A' },
      after: { title: 'B' },
      via: 'web',
      batchId: 'batch-1',
      userId: owner.id,
    })
  })

  test('a no-op update writes no change log row', async () => {
    const { db, owner, show } = await setup()
    await updateShow(db, actor(owner.id), { showId: show.id, patch: { title: 'A' } })
    expect(await db.select().from(changeLog).where(eq(changeLog.rowId, show.id))).toHaveLength(1)
  })
})

describe('archived shows are read-only', () => {
  test('owner cannot rename an archived show but can unarchive it', async () => {
    const { db, owner, show } = await setup()
    await updateShow(db, actor(owner.id), { showId: show.id, patch: { status: 'archived' } })
    expect(
      await code(updateShow(db, actor(owner.id), { showId: show.id, patch: { title: 'B' } })),
    ).toBe('forbidden')
    expect(
      await code(
        updateShow(db, actor(owner.id), { showId: show.id, patch: { status: 'prep', title: 'B' } }),
      ),
    ).toBe('forbidden')
    const back = await updateShow(db, actor(owner.id), {
      showId: show.id,
      patch: { status: 'prep' },
    })
    expect(back.status).toBe('prep')
  })

  test('addShowMember on an archived show is forbidden', async () => {
    const { mail, app, deps, owner, show } = await setup()
    await createTestUser(app, deps, { email: mail.n, name: 'N', password: 'password123' })
    await updateShow(deps.db, actor(owner.id), { showId: show.id, patch: { status: 'archived' } })
    expect(
      await code(
        addShowMember(deps.db, actor(owner.id), {
          showId: show.id,
          email: mail.n,
          role: 'viewer',
        }),
      ),
    ).toBe('forbidden')
  })

  test('assertShowWritable', () => {
    expect(() => assertShowWritable({ status: 'running' })).not.toThrow()
    expect(() => assertShowWritable({ status: 'archived' })).toThrow('show is archived')
    expect(() =>
      assertShowWritable(
        { status: 'archived' },
        { allowUnarchive: true, patch: { status: 'archived' } },
      ),
    ).toThrow()
    expect(() =>
      assertShowWritable(
        { status: 'archived' },
        { allowUnarchive: true, patch: { status: 'prep' } },
      ),
    ).not.toThrow()
  })
})

describe('tenancy HTTP', () => {
  const json = (cookie: string, method: string, body?: unknown) => ({
    method,
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  test('PATCH /api/shows/:id as viewer is 403', async () => {
    const { app, viewer, show } = await setup()
    const res = await app.request(
      `/api/shows/${show.id}`,
      json(viewer.cookie, 'PATCH', { title: 'Nope' }),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('forbidden')
  })

  test('every tenancy route rejects a missing session with 401', async () => {
    const { app } = await setup()
    const routes = [
      ['GET', '/api/me/orgs'],
      ['POST', '/api/orgs'],
      ['GET', '/api/me/shows'],
      ['POST', '/api/orgs/o1/shows'],
      ['PATCH', '/api/shows/s1'],
      ['POST', '/api/shows/s1/members'],
    ] as const
    for (const [method, path] of routes) {
      const res = await app.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      })
      expect(res.status, `${method} ${path}`).toBe(401)
      expect(((await res.json()) as { error: string }).error).toBe('unauthenticated')
    }
  })

  test('routes require a session', async () => {
    const { app } = await setup()
    expect((await app.request('/api/me/shows')).status).toBe(401)
  })

  test('org, show, patch, member flow', async () => {
    const { mail, app, owner } = await setup()
    const orgRes = await app.request('/api/orgs', json(owner.cookie, 'POST', { name: 'Co' }))
    expect(orgRes.status).toBe(201)
    const { organisation } = (await orgRes.json()) as { organisation: { id: string } }
    const showRes = await app.request(
      `/api/orgs/${organisation.id}/shows`,
      json(owner.cookie, 'POST', { title: 'Hamlet' }),
    )
    expect(showRes.status).toBe(201)
    const { show } = (await showRes.json()) as { show: { id: string } }
    const patch = await app.request(
      `/api/shows/${show.id}`,
      json(owner.cookie, 'PATCH', { status: 'rehearsal', settings: { a: 1 } }),
    )
    expect(patch.status).toBe(200)
    const member = await app.request(
      `/api/shows/${show.id}/members`,
      json(owner.cookie, 'POST', { email: mail.v, role: 'viewer' }),
    )
    expect(member.status).toBe(201)
    const orgs = await app.request('/api/me/orgs', { headers: { cookie: owner.cookie } })
    expect(
      ((await orgs.json()) as { organisations: unknown[] }).organisations.length,
    ).toBeGreaterThanOrEqual(2)
    const shows = await app.request('/api/me/shows', { headers: { cookie: owner.cookie } })
    const body = (await shows.json()) as {
      active: { title: string; role: string }[]
      archived: unknown[]
    }
    expect(body.active.find((s) => s.title === 'Hamlet')?.role).toBe('owner')
  })

  test('validation failures are 400 in the JSON shape', async () => {
    const { mail, app, owner, show } = await setup()
    for (const [path, method, body] of [
      ['/api/orgs', 'POST', { name: '' }],
      [`/api/shows/${show.id}`, 'PATCH', { title: 'x'.repeat(201) }],
      [`/api/shows/${show.id}`, 'PATCH', { status: 'bogus' }],
      [`/api/shows/${show.id}/members`, 'POST', { email: mail.v, role: 'god' }],
    ] as const) {
      const res = await app.request(path, json(owner.cookie, method, body))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid')
    }
    const bad = await app.request('/api/orgs', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: APP_ORIGIN, 'content-type': 'application/json' },
      body: '{nope',
    })
    expect(bad.status).toBe(400)
  })
})
