import type { PresencePeer, PresenceState } from '@binder/shared'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPresenceClient } from './client'

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

function start() {
  const client = createPresenceClient({
    url: URL,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  })
  return { client, ws: () => FakeWebSocket.instances.at(-1) as FakeWebSocket }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
})
afterEach(() => {
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

  test('a welcome resets the backoff to 1s', () => {
    const { client, ws } = start()
    ws().drop(1006)
    vi.advanceTimersByTime(1000)
    ws().drop(1006)
    vi.advanceTimersByTime(2000)
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [] })
    ws().drop(1001)
    const before = FakeWebSocket.instances.length
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
    client.close()
  })

  test.each([1001, 4408, 4429, 1006, 1008])('close %i is retried with backoff', (code) => {
    const { client, ws } = start()
    ws().drop(code)
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    client.close()
  })

  test.each([4401, 4403])('close %i is terminal: no reconnect, no peers', (code) => {
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

describe('peers', () => {
  test('welcome, peer and leave keep the peer list; a changed peer moves to the end', () => {
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
      ['c-ben', 2],
      ['c-ana', 5],
    ])
    ws().receive({ type: 'leave', connId: 'c-ben' })
    expect(seen.at(-1)?.map((p) => p.connId)).toEqual(['c-ana'])
    client.close()
  })

  test('a newcomer announced with no state is kept as a peer with null fields', () => {
    const { client, ws } = start()
    const seen: PresencePeer[][] = []
    client.subscribe((peers) => seen.push(peers))
    ws().open()
    ws().receive({ type: 'welcome', connId: 'me', peers: [] })
    const bare = { ...ben, documentId: null, versionId: null, pageIndex: null, selection: null }
    ws().receive({ type: 'peer', peer: bare })
    expect(seen.at(-1)).toEqual([bare])
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
