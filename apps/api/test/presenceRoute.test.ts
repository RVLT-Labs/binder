import { user } from '@binder/db'
import {
  type Actor,
  PRESENCE_MAX_CONNECTIONS_PER_USER,
  type PresenceState,
  presenceColour,
  type ServerMessage,
} from '@binder/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WebSocket } from 'ws'
import {
  addShowMember,
  createShow,
  listOrganisations,
  removeShowMember,
  updateShow,
} from '../src/services'
import { APP_ORIGIN, createTestApp, createTestUser, listen } from './helpers'

const actor = (userId: string): Actor => ({ userId, via: 'web', agent: null })

const state = (over: Partial<PresenceState> = {}): PresenceState => ({
  documentId: 'doc-1',
  versionId: 'ver-1',
  pageIndex: 1,
  selection: { table: 'cues', id: 'cue-1' },
  ...over,
})
const stateMessage = (s: PresenceState = state()) => JSON.stringify({ type: 'state', state: s })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(10)
  }
}

/** A `ws` client that records everything the server sends and how it closed. */
class Client {
  readonly messages: ServerMessage[] = []
  readonly raw: string[] = []
  closed: { code: number; reason: string } | null = null
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString()
      this.raw.push(text)
      this.messages.push(JSON.parse(text))
    })
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() }
    })
  }
  static open(url: string, headers: Record<string, string>): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers })
      const client = new Client(ws)
      ws.once('open', () => resolve(client))
      ws.once('unexpected-response', (_req, res) =>
        reject(new Error(`refused with ${res.statusCode}`)),
      )
      ws.once('error', reject)
    })
  }
  of<T extends ServerMessage['type']>(type: T) {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
  }
  send(data: string | Buffer) {
    this.ws.send(data)
  }
  waitClosed(): Promise<{ code: number; reason: string }> {
    return until(() => this.closed !== null, 'the socket to close').then(
      () => this.closed as { code: number; reason: string },
    )
  }
}

let n = 0

async function setup(options: { recheckMs?: number } = {}) {
  const i = ++n
  const { app, deps } = await createTestApp({ presenceOptions: { recheckMs: options.recheckMs } })
  const server = await listen(app)
  cleanups.push(server.close)
  const mk = (key: string, name: string) =>
    createTestUser(app, deps, { email: `${key}${i}@pres.test`, name, password: 'password123' })
  const owner = await mk('o', 'Olive')
  const bea = await mk('b', 'Bea')
  const outsider = await mk('x', 'Xavier')
  const [org] = await listOrganisations(deps.db, actor(owner.id))
  const show = await createShow(deps.db, actor(owner.id), { organisationId: org.id, title: 'P' })
  const membership = await addShowMember(deps.db, actor(owner.id), {
    showId: show.id,
    email: `b${i}@pres.test`,
    role: 'viewer',
  })
  const url = (showId = show.id) => `ws://127.0.0.1:${server.port}/api/shows/${showId}/presence`
  const clients: Client[] = []
  const connect = async (
    who: { cookie: string },
    over: { origin?: string | null; showId?: string } = {},
  ) => {
    const headers: Record<string, string> = { cookie: who.cookie }
    const origin = over.origin === undefined ? APP_ORIGIN : over.origin
    if (origin !== null) headers.origin = origin
    const client = await Client.open(url(over.showId), headers)
    clients.push(client)
    cleanups.push(async () => client.ws.terminate())
    return client
  }
  const refusal = async (
    who: { cookie: string } | null,
    over: { origin?: string | null; showId?: string } = {},
  ): Promise<number> => {
    const headers: Record<string, string> = {}
    if (who) headers.cookie = who.cookie
    const origin = over.origin === undefined ? APP_ORIGIN : over.origin
    if (origin !== null) headers.origin = origin
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url(over.showId), { headers })
      ws.once('open', () => {
        ws.terminate()
        resolve(101)
      })
      ws.once('unexpected-response', (_req, res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      ws.once('error', reject)
    })
  }
  return { app, deps, server, owner, bea, outsider, org, show, membership, connect, refusal }
}

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('GET /api/shows/:showId/presence', () => {
  test('no session is 401 and a non-member is 404 before any upgrade', async () => {
    const s = await setup()
    expect(await s.refusal(null)).toBe(401)
    expect(await s.refusal({ cookie: 'better-auth.session_token=nonsense' })).toBe(401)
    expect(await s.refusal(s.outsider)).toBe(404)
    expect(await s.refusal(s.owner, { showId: 'no-such-show' })).toBe(404)
    // No connection was ever registered for any of the refusals.
    expect(s.deps.presence.peers(s.show.id)).toEqual([])
  })

  test('an upgrade from another origin is 403 and opens no socket', async () => {
    const s = await setup()
    expect(await s.refusal(s.owner, { origin: 'https://evil.example' })).toBe(403)
    // The origin must match exactly: same host on another port or scheme is another origin.
    expect(await s.refusal(s.owner, { origin: 'http://localhost:5174' })).toBe(403)
    expect(await s.refusal(s.owner, { origin: 'https://localhost:5173' })).toBe(403)
    // A missing Origin is refused too: a browser always sends one on a WebSocket handshake.
    expect(await s.refusal(s.owner, { origin: null })).toBe(403)
    // The origin check comes before the session check.
    expect(await s.refusal(null, { origin: 'https://evil.example' })).toBe(403)
    expect(s.deps.presence.peers(s.show.id)).toEqual([])
  })

  test('a plain GET without an upgrade is 426', async () => {
    const s = await setup()
    const res = await fetch(`http://127.0.0.1:${s.server.port}/api/shows/${s.show.id}/presence`, {
      headers: { cookie: s.owner.cookie, origin: APP_ORIGIN },
    })
    expect(res.status).toBe(426)
  })

  test("two members see each other's state", async () => {
    const s = await setup()
    // The name comes from the user table at connect time, not from anything the client says.
    await s.deps.db.update(user).set({ name: 'Beatrice' }).where(eq(user.id, s.bea.id))

    const owner = await s.connect(s.owner)
    await until(() => owner.of('welcome').length === 1, 'the owner welcome')
    expect(owner.of('welcome')[0].peers).toEqual([])
    const ownerConn = owner.of('welcome')[0].connId

    owner.send(stateMessage(state({ pageIndex: 4 })))
    await sleep(50) // let the server record the owner's state before Bea arrives

    const bea = await s.connect(s.bea)
    await until(() => bea.of('welcome').length === 1, "Bea's welcome")
    const beaConn = bea.of('welcome')[0].connId
    expect(beaConn).not.toBe(ownerConn)
    expect(bea.of('welcome')[0].peers).toEqual([
      {
        connId: ownerConn,
        userId: s.owner.id,
        name: 'Olive',
        colour: presenceColour(s.owner.id),
        ...state({ pageIndex: 4 }),
      },
    ])

    bea.send(stateMessage(state({ pageIndex: 9, selection: { table: 'annotations', id: 'a-1' } })))
    await until(() => owner.of('peer').some((m) => m.peer.pageIndex === 9), "Bea's state")
    const seen = owner.of('peer').find((m) => m.peer.pageIndex === 9)?.peer
    expect(seen).toEqual({
      connId: beaConn,
      userId: s.bea.id,
      name: 'Beatrice',
      colour: presenceColour(s.bea.id),
      ...state({ pageIndex: 9, selection: { table: 'annotations', id: 'a-1' } }),
    })
    // The sender is not echoed its own state.
    expect(bea.of('peer').some((m) => m.peer.connId === beaConn)).toBe(false)

    // Nothing but the protocol fields ever goes over the wire: no email, no other user field.
    for (const text of [...owner.raw, ...bea.raw]) {
      expect(text).not.toContain('@pres.test')
      expect(text).not.toContain('password')
    }

    bea.ws.close()
    await until(() => owner.of('leave').length === 1, "Bea's leave")
    expect(owner.of('leave')[0]).toEqual({ type: 'leave', connId: beaConn })
  })

  test('shows are isolated from each other', async () => {
    const s = await setup()
    const second = await createShow(s.deps.db, actor(s.owner.id), {
      organisationId: s.org.id,
      title: 'Q',
    })
    const here = await s.connect(s.owner)
    const there = await s.connect(s.owner, { showId: second.id })
    await until(
      () => here.of('welcome').length === 1 && there.of('welcome').length === 1,
      'welcomes',
    )
    here.send(stateMessage())
    await sleep(100)
    expect(there.of('peer')).toEqual([])
    expect(there.of('welcome')[0].peers).toEqual([])
  })

  test('an archived show still allows presence', async () => {
    const s = await setup()
    await updateShow(s.deps.db, actor(s.owner.id), {
      showId: s.show.id,
      patch: { status: 'archived' },
    })
    const bea = await s.connect(s.bea)
    await until(() => bea.of('welcome').length === 1, 'the welcome')
  })

  test('malformed JSON and invalid state are ignored; the connection stays up', async () => {
    const s = await setup()
    const watcher = await s.connect(s.owner)
    const sender = await s.connect(s.bea)
    await until(() => watcher.of('peer').length === 1, 'the join announcement')
    const before = watcher.messages.length

    sender.send('not json at all')
    sender.send('{"type":"state"')
    sender.send(Buffer.from([1, 2, 3])) // binary
    sender.send(JSON.stringify({ type: 'hello' }))
    sender.send(stateMessage(state({ selection: { table: 'users' as 'cues', id: 'x' } })))
    sender.send(stateMessage(state({ documentId: '' })))
    sender.send(stateMessage(state({ pageIndex: -1 })))
    sender.send(stateMessage(state({ selection: { table: 'cues', id: 'x'.repeat(201) } })))
    await sleep(150)
    expect(watcher.messages.length).toBe(before)
    expect(sender.closed).toBeNull()

    sender.send(stateMessage(state({ pageIndex: 12 })))
    await until(() => watcher.of('peer').some((m) => m.peer.pageIndex === 12), 'a valid state')
  })

  test('an oversized frame closes with 1009', async () => {
    const s = await setup()
    const watcher = await s.connect(s.owner)
    const big = await s.connect(s.bea)
    await until(() => watcher.of('peer').length === 1, 'the join announcement')

    // 2048 bytes is allowed (here ignored as junk); one more byte is not.
    big.send('x'.repeat(2048))
    await sleep(100)
    expect(big.closed).toBeNull()

    big.send('x'.repeat(2049))
    expect((await big.waitClosed()).code).toBe(1009)
    await until(() => watcher.of('leave').length === 1, 'the leave')
    expect(s.deps.presence.connectionCount(s.show.id, s.bea.id)).toBe(0)
  })

  test('removing the membership closes the socket with 4403 within the recheck interval', async () => {
    const s = await setup({ recheckMs: 100 })
    const owner = await s.connect(s.owner)
    const bea = await s.connect(s.bea)
    await until(() => owner.of('peer').length === 1, 'the join announcement')

    await removeShowMember(s.deps.db, actor(s.owner.id), { membershipId: s.membership.id })
    const closed = await bea.waitClosed()
    expect(closed.code).toBe(4403)
    await until(() => owner.of('leave').length === 1, 'the leave')
    expect(owner.of('leave')).toHaveLength(1)
    expect(owner.closed).toBeNull()
    expect(s.deps.presence.peers(s.show.id)).toHaveLength(1)
  })

  test('a sixth connection for the same user and show is 429', async () => {
    const s = await setup()
    const open: Client[] = []
    for (let k = 0; k < PRESENCE_MAX_CONNECTIONS_PER_USER; k++) open.push(await s.connect(s.bea))
    expect(await s.refusal(s.bea)).toBe(429)
    // The limit is per user and per show.
    const other = await s.connect(s.owner)
    await until(() => other.of('welcome').length === 1, 'the owner welcome')
    // A connection that ends frees its slot.
    open[0].ws.close()
    await until(() => s.deps.presence.connectionCount(s.show.id, s.bea.id) === 4, 'a free slot')
    const again = await s.connect(s.bea)
    await until(() => again.of('welcome').length === 1, 'the welcome')
    expect(s.deps.presence.connectionCount(s.show.id, s.bea.id)).toBe(5)
  })

  test('frames beyond 20 a second are dropped and a flood closes with 1008', async () => {
    const s = await setup()
    const watcher = await s.connect(s.owner)
    const sender = await s.connect(s.bea)
    await until(() => watcher.of('peer').length === 1, 'the join announcement')

    // 60 frames at once: roughly the first 20 pass, the rest are dropped, and the socket stays open.
    for (let k = 0; k < 60; k++) sender.send(stateMessage(state({ pageIndex: k + 1 })))
    await sleep(300)
    const passed = watcher.of('peer').filter((m) => m.peer.pageIndex !== null).length
    expect(passed).toBeGreaterThanOrEqual(20)
    expect(passed).toBeLessThanOrEqual(24)
    expect(sender.closed).toBeNull()

    // More than five times the limit inside one second is abuse.
    const flooder = await s.connect(s.bea)
    for (let k = 0; k < 150; k++) flooder.send(stateMessage(state({ pageIndex: k })))
    expect((await flooder.waitClosed()).code).toBe(1008)
    await until(
      () => s.deps.presence.connectionCount(s.show.id, s.bea.id) === 1,
      'the flooder to leave',
    )
  })

  test('a closed socket leaves once and every per-connection timer is cleared', async () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const s = await setup({ recheckMs: 4321 })
    const watcher = await s.connect(s.owner)
    const leaving = await s.connect(s.bea)
    await until(() => watcher.of('peer').length === 1, 'the join announcement')
    const recheckTimers = setSpy.mock.results
      .filter((_r, k) => setSpy.mock.calls[k][1] === 4321)
      .map((r) => r.value)
    expect(recheckTimers).toHaveLength(2)

    leaving.ws.terminate() // an abrupt end: the close event may arrive after an error
    await until(() => watcher.of('leave').length >= 1, 'the leave')
    await sleep(100)
    expect(watcher.of('leave')).toHaveLength(1)
    expect(clearSpy.mock.calls.map((c) => c[0])).toContain(recheckTimers[1])

    watcher.ws.close()
    await until(() => s.deps.presence.peers(s.show.id).length === 0, 'the hub to empty')
    expect(clearSpy.mock.calls.map((c) => c[0])).toContain(recheckTimers[0])
  })
})
