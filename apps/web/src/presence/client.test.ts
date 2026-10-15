import type { PresencePeer, PresenceState } from '@binder/shared'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPresenceClient, PRESENCE_MAX_FAILED_ATTEMPTS, PRESENCE_STABLE_MS } from './client'
import { latestPerUser, peersByPage } from './peers'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  closed: number | null = null
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code = 1000) {
    this.readyState = 3
    this.closed = code
  }
  // Test drivers.
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  drop(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  get states(): PresenceState[] {
    return this.sent.map((s) => JSON.parse(s).state)
  }
}

const URL = 'ws://localhost/api/shows/s1/presence'
const page = (pageIndex: number): PresenceState => ({
  documentId: 'd1',
  versionId: 'v1',
  pageIndex,
  selection: null,
})
const ana: PresencePeer = {
  connId: 'c-ana',
  userId: 'u-ana',
  name: 'Ana',
  colour: '#e6194b',
  ...page(2),
}
const ben: PresencePeer = { ...ana, connId: 'c-ben', userId: 'u-ben', name: 'Ben' }

const started: Array<{ close(): void }> = []
function start() {
  const client = createPresenceClient({
    url: URL,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  })
  started.push(client)
  return { client, ws: () => FakeWebSocket.instances.at(-1) as FakeWebSocket }
}

let visibility: 'visible' | 'hidden' = 'visible'
/** A tab coming back to the front. */
function becomeVisible() {
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  FakeWebSocket.instances = []
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.useFakeTimers()
})
afterEach(() => {
  for (const c of started.splice(0)) c.close()
  vi.useRealTimers()
})

describe('sending', () => {
  test('sends on change at most every 250ms and a heartbeat every 5s', () => {
    const { client, ws } = start()
    expect(ws().url).toBe(URL)
    ws().open()
    // The state at connection goes out at once.
    expect(ws().sent).toHaveLength(1)

    client.setState(page(1))
    client.setState(page(2))
    client.setState(page(3))
    // Inside the window nothing more is sent...
    vi.advanceTimersByTime(249)
    expect(ws().sent).toHaveLength(1)
    // ...and at its end one message carries the latest state, not each change.
    vi.advanceTimersByTime(1)
    expect(ws().sent).toHaveLength(2)
    expect(ws().states.at(-1)).toEqual(page(3))

    // An unchanged state is not a change.
    client.setState({ ...page(3) })
    vi.advanceTimersByTime(250)
    expect(ws().sent).toHaveLength(2)

    // After a quiet spell a change goes out immediately.
    vi.advanceTimersByTime(1000)
    client.setState(page(4))
    expect(ws().sent).toHaveLength(3)

    // Five seconds after the last message the state is sent again as a heartbeat, and again.
    vi.advanceTimersByTime(4999)
    expect(ws().sent).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(ws().sent).toHaveLength(4)
    expect(ws().states.at(-1)).toEqual(page(4))
    vi.advanceTimersByTime(5000)
    expect(ws().sent).toHaveLength(5)
    client.close()
  })

  test('sends nothing before the socket is open and then sends the latest state once', () => {
    const { client, ws } = start()
    client.setState(page(1))
    client.setState(page(2))
    expect(ws().sent).toHaveLength(0)
    ws().open()
    expect(ws().states).toEqual([page(2)])
    client.close()
  })

  test('uses injected timers', () => {
    const calls: number[] = []
    const client = createPresenceClient({
      url: URL,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      setTimer: ((fn: () => void, ms: number) => {
        calls.push(ms)
        return setTimeout(fn, ms)
      }) as unknown as typeof setTimeout,
      clearTimer: clearTimeout,
    })
    FakeWebSocket.instances[0].open()
    expect(calls).toContain(5000)
    expect(calls).toContain(250)
    client.close()
  })
})

describe('reconnecting', () => {
  test('reconnects with backoff 1s, 2s, 4s up to 30s and resends its state', () => {
    const { client, ws } = start()
    client.setState(page(7))
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000]
    for (const delay of delays) {
      const before = FakeWebSocket.instances.length
      // Each connection opens and is dropped before it proves stable, so the backoff keeps growing.
      ws().open()
      ws().drop(1006)
      vi.advanceTimersByTime(delay - 1)
      expect(FakeWebSocket.instances).toHaveLength(before)
      vi.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(before + 1)
    }
    ws().open()
    expect(ws().states).toEqual([page(7)])
    client.close()
  })

  test('a socket error reconnects the same way, once', () => {
    const { client, ws } = start()
    ws().onerror?.({})
    // The browser then closes the socket too; that must not queue a second attempt.
    ws().drop(1006)
    const before = FakeWebSocket.instances.length
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
    client.close()
  })

  test('the backoff starts over only after the connection stayed open for the stability window', () => {
    const { client, ws } = start()
    ws().drop(1006)
    vi.advanceTimersByTime(1000)
    ws().drop(1006)
    vi.advanceTimersByTime(2000)
    // Welcomed, then dropped at once: still backing off (next wait is 4 s, not 1 s).
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [] })
    ws().drop(1001)
    let before = FakeWebSocket.instances.length
    vi.advanceTimersByTime(3999)
    expect(FakeWebSocket.instances).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(before + 1)

    // Open and welcomed for the whole window: the next drop retries after 1 s.
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [] })
    vi.advanceTimersByTime(PRESENCE_STABLE_MS)
    ws().drop(1001)
    before = FakeWebSocket.instances.length
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
    client.close()
  })

  test.each([1001, 4408, 4429, 1006])('close %i is retried with backoff', (code) => {
    const { client, ws } = start()
    ws().drop(code)
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    client.close()
  })

  test.each([4401, 4403, 1008, 1009])('close %i is terminal: no reconnect, no peers', (code) => {
    const { client, ws } = start()
    const seen: Array<[number, boolean]> = []
    client.subscribe((peers, connected) => seen.push([peers.length, connected]))
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [ana] })
    ws().drop(code)
    vi.advanceTimersByTime(10 * 60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(seen.at(-1)).toEqual([0, false])
    // A later state change does not wake it.
    client.setState(page(1))
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  test('a terminal close is not undone by the tab coming back or the network returning', () => {
    const { ws } = start()
    ws().drop(4403)
    becomeVisible()
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  test('close() stops everything and never reconnects', () => {
    const { client, ws } = start()
    ws().open()
    const socket = ws()
    client.close()
    expect(socket.closed).not.toBeNull()
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket.sent).toHaveLength(1)
  })
})

describe('giving up on a show that refuses every connection', () => {
  /** Fails `n` attempts in a row, each waiting out its backoff, without any socket ever opening. */
  function failAttempts(ws: () => FakeWebSocket, n: number) {
    let wait = 1000
    for (let i = 0; i < n; i++) {
      ws().drop(1006)
      if (i < n - 1) {
        vi.advanceTimersByTime(wait)
        wait = Math.min(wait * 2, 30_000)
      }
    }
  }

  test('stops after five attempts that never opened, with no timer left running', () => {
    const { ws } = start()
    failAttempts(ws, PRESENCE_MAX_FAILED_ATTEMPTS)
    expect(FakeWebSocket.instances).toHaveLength(PRESENCE_MAX_FAILED_ATTEMPTS)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10 * 60_000)
    expect(FakeWebSocket.instances).toHaveLength(PRESENCE_MAX_FAILED_ATTEMPTS)
  })

  test('an attempt that opened resets the count', () => {
    const { ws } = start()
    failAttempts(ws, PRESENCE_MAX_FAILED_ATTEMPTS - 1)
    vi.advanceTimersByTime(8000)
    ws().open()
    ws().drop(1006)
    vi.advanceTimersByTime(30_000)
    // Four more failures are within the allowance: a retry is still pending after the fourth.
    for (let i = 0; i < PRESENCE_MAX_FAILED_ATTEMPTS - 2; i++) {
      ws().drop(1006)
      vi.advanceTimersByTime(30_000)
    }
    ws().drop(1006)
    expect(vi.getTimerCount()).toBe(1)
  })

  test('resumes when the tab becomes visible', () => {
    const { ws } = start()
    failAttempts(ws, PRESENCE_MAX_FAILED_ATTEMPTS)
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWebSocket.instances).toHaveLength(PRESENCE_MAX_FAILED_ATTEMPTS)
    becomeVisible()
    expect(FakeWebSocket.instances).toHaveLength(PRESENCE_MAX_FAILED_ATTEMPTS + 1)
    // And it has its full allowance again.
    failAttempts(ws, PRESENCE_MAX_FAILED_ATTEMPTS)
    expect(FakeWebSocket.instances).toHaveLength(2 * PRESENCE_MAX_FAILED_ATTEMPTS)
  })

  test('resumes when the network comes back', () => {
    const { ws } = start()
    failAttempts(ws, PRESENCE_MAX_FAILED_ATTEMPTS)
    window.dispatchEvent(new Event('online'))
    expect(FakeWebSocket.instances).toHaveLength(PRESENCE_MAX_FAILED_ATTEMPTS + 1)
  })

  test('a new client for the show (a show change or coming online) starts fresh', () => {
    const { ws } = start()
    failAttempts(ws, PRESENCE_MAX_FAILED_ATTEMPTS)
    const before = FakeWebSocket.instances.length
    start()
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
  })

  test('close() after giving up removes the wake listeners', () => {
    const { client, ws } = start()
    failAttempts(ws, PRESENCE_MAX_FAILED_ATTEMPTS)
    client.close()
    becomeVisible()
    window.dispatchEvent(new Event('online'))
    expect(FakeWebSocket.instances).toHaveLength(PRESENCE_MAX_FAILED_ATTEMPTS)
  })
})

describe('a tab coming back to the front', () => {
  test('resends its state at once instead of waiting for a timer', () => {
    const { client, ws } = start()
    ws().open()
    client.setState(page(1))
    vi.advanceTimersByTime(250)
    const sent = ws().sent.length
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ws().sent).toHaveLength(sent)
    vi.advanceTimersByTime(1000)
    becomeVisible()
    expect(ws().sent).toHaveLength(sent + 1)
    expect(ws().states.at(-1)).toEqual(page(1))
  })

  test('reconnects at once if the socket was lost, without waiting out the backoff', () => {
    const { ws } = start()
    ws().open()
    ws().drop(1006)
    vi.advanceTimersByTime(300)
    expect(FakeWebSocket.instances).toHaveLength(1)
    becomeVisible()
    expect(FakeWebSocket.instances).toHaveLength(2)
    // The abandoned retry timer does not make a third.
    vi.advanceTimersByTime(5000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  test('does nothing while the socket is still connecting', () => {
    start()
    becomeVisible()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

describe('peers', () => {
  test('welcome, peer and leave keep the peer list; a changed peer keeps its place', () => {
    const { client, ws } = start()
    const seen: PresencePeer[][] = []
    client.subscribe((peers) => seen.push(peers))
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [ana] })
    expect(seen.at(-1)?.map((p) => p.connId)).toEqual(['c-ana'])
    ws().receive({ type: 'peer', peer: ben })
    expect(seen.at(-1)?.map((p) => p.connId)).toEqual(['c-ana', 'c-ben'])
    ws().receive({ type: 'peer', peer: { ...ana, ...page(5) } })
    expect(seen.at(-1)?.map((p) => [p.connId, p.pageIndex])).toEqual([
      ['c-ana', 5],
      ['c-ben', 2],
    ])
    ws().receive({ type: 'leave', connId: 'c-ben' })
    expect(seen.at(-1)?.map((p) => p.connId)).toEqual(['c-ana'])
    client.close()
  })

  test("heartbeats repeating a peer's state change nothing: stable order, no notification, one entry per user", () => {
    const { client, ws } = start()
    const seen: PresencePeer[][] = []
    client.subscribe((peers) => seen.push(peers))
    ws().open()
    const tab1 = { ...ana, connId: 'ana-1', ...page(2) }
    const tab2 = { ...ana, connId: 'ana-2', ...page(4) }
    ws().receive({ type: 'welcome', connId: 'me', peers: [tab1, tab2, ben] })
    const notified = seen.length
    const order = () => seen.at(-1)?.map((p) => p.connId)
    expect(order()).toEqual(['ana-1', 'ana-2', 'c-ben'])
    // Ana's tabs each heartbeat the same state, over and over, tab 1 last.
    for (let i = 0; i < 3; i++) {
      ws().receive({ type: 'peer', peer: tab2 })
      ws().receive({ type: 'peer', peer: ben })
      ws().receive({ type: 'peer', peer: tab1 })
    }
    expect(seen).toHaveLength(notified)
    expect(order()).toEqual(['ana-1', 'ana-2', 'c-ben'])
    // Ana is on one page only, the one of the tab that last changed, and it does not alternate.
    const onPage = () => {
      const byPage = peersByPage(seen.at(-1) ?? [], 'v1')
      return [...byPage]
        .sort(([a], [b]) => a - b)
        .map(([n, list]) => [n, list.map((p) => p.userId)])
    }
    const expected = [
      [2, ['u-ben']],
      [4, ['u-ana']],
    ]
    expect(onPage()).toEqual(expected)
    ws().receive({ type: 'peer', peer: tab1 })
    expect(onPage()).toEqual(expected)
    expect(latestPerUser(seen.at(-1) ?? [])).toHaveLength(2)

    // A real page change moves that user's avatar, and only then is there a notification.
    ws().receive({ type: 'peer', peer: { ...tab1, ...page(6) } })
    expect(seen).toHaveLength(notified + 1)
    expect(order()).toEqual(['ana-1', 'ana-2', 'c-ben'])
    expect(onPage()).toEqual([
      [2, ['u-ben']],
      [6, ['u-ana']],
    ])
    client.close()
  })

  test('nothing is announced for a disconnect that had nothing to drop', () => {
    const { ws, client } = start()
    const fn = vi.fn()
    client.subscribe(fn)
    fn.mockClear()
    ws().drop(1006)
    vi.advanceTimersByTime(1000)
    ws().drop(1006)
    expect(fn).not.toHaveBeenCalled()
  })

  test('a newcomer announced with no state is kept as a peer with null fields', () => {
    const { client, ws } = start()
    const seen: PresencePeer[][] = []
    client.subscribe((peers) => seen.push(peers))
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [] })
    const bare = { ...ben, documentId: null, versionId: null, pageIndex: null, selection: null }
    ws().receive({ type: 'peer', peer: bare })
    expect(seen.at(-1)).toEqual([expect.objectContaining(bare)])
    client.close()
  })

  test('peers are cleared on disconnect', () => {
    const { client, ws } = start()
    const seen: Array<[string[], boolean]> = []
    client.subscribe((peers, connected) => seen.push([peers.map((p) => p.connId), connected]))
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [ana, ben] })
    expect(seen.at(-1)).toEqual([['c-ana', 'c-ben'], true])
    ws().drop(1006)
    expect(seen.at(-1)).toEqual([[], false])
    // After reconnecting, peers are those of the new welcome only.
    vi.advanceTimersByTime(1000)
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me2', peers: [ben] })
    expect(seen.at(-1)).toEqual([['c-ben'], true])
    client.close()
  })

  test('ignores malformed frames and never lists itself', () => {
    const { client, ws } = start()
    const seen: PresencePeer[][] = []
    client.subscribe((peers) => seen.push(peers))
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [] })
    ws().onmessage?.({ data: 'not json' })
    ws().receive({ type: 'peer', peer: { connId: 'x' } })
    ws().receive({ type: 'nonsense' })
    ws().receive({ type: 'peer', peer: { ...ben, connId: 'me' } })
    expect(seen.at(-1)).toEqual([])
    client.close()
  })

  test('unsubscribe stops notifications', () => {
    const { client, ws } = start()
    const fn = vi.fn()
    const off = client.subscribe(fn)
    fn.mockClear()
    off()
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [ana] })
    expect(fn).not.toHaveBeenCalled()
    client.close()
  })
})
