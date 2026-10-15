import {
  EMPTY_PRESENCE_STATE,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TIMEOUT_MS,
  type PresenceState,
  presenceColour,
  type ServerMessage,
} from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { type PresenceConn, PresenceHub } from '../src/presence/hub'

class RecordingConn implements PresenceConn {
  readonly sent: ServerMessage[] = []
  readonly closed: { code: number; reason: string }[] = []
  constructor(
    readonly id: string,
    readonly userId: string,
    readonly name: string,
  ) {}
  send(msg: ServerMessage): void {
    this.sent.push(msg)
  }
  close(code: number, reason: string): void {
    this.closed.push({ code, reason })
  }
  /** Messages of one type, in order. */
  of<T extends ServerMessage['type']>(type: T) {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
  }
}

const state = (over: Partial<PresenceState> = {}): PresenceState => ({
  documentId: 'doc-1',
  versionId: 'ver-1',
  pageIndex: 2,
  selection: { table: 'cues', id: 'cue-1' },
  ...over,
})

function setup() {
  let t = 1_000_000
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
  const hub = new PresenceHub({ now: clock.now })
  return { hub, clock }
}

describe('PresenceHub', () => {
  test('join welcomes with the other peers; update fans out to the same show only', () => {
    const { hub } = setup()
    const ann = new RecordingConn('c-ann', 'u-ann', 'Ann')
    const bo = new RecordingConn('c-bo', 'u-bo', 'Bo')
    const other = new RecordingConn('c-zed', 'u-zed', 'Zed')

    hub.join('show-1', ann)
    expect(ann.sent).toEqual([{ type: 'welcome', connId: 'c-ann', peers: [] }])

    hub.update('show-1', 'c-ann', state())
    hub.join('show-1', bo)
    // The newcomer is told about Ann, with her state and per-user colour, and never about itself.
    expect(bo.of('welcome')).toEqual([
      {
        type: 'welcome',
        connId: 'c-bo',
        peers: [
          {
            connId: 'c-ann',
            userId: 'u-ann',
            name: 'Ann',
            colour: presenceColour('u-ann'),
            ...state(),
          },
        ],
      },
    ])
    // Ann hears about Bo arriving, with an empty state until he says more.
    expect(ann.of('peer').at(-1)?.peer).toEqual({
      connId: 'c-bo',
      userId: 'u-bo',
      name: 'Bo',
      colour: presenceColour('u-bo'),
      ...EMPTY_PRESENCE_STATE,
    })

    hub.join('show-2', other)
    ann.sent.length = 0
    bo.sent.length = 0
    other.sent.length = 0

    const next = state({ pageIndex: 7, selection: null })
    hub.update('show-1', 'c-bo', next)
    expect(ann.sent).toEqual([
      {
        type: 'peer',
        peer: {
          connId: 'c-bo',
          userId: 'u-bo',
          name: 'Bo',
          colour: presenceColour('u-bo'),
          ...next,
        },
      },
    ])
    expect(bo.sent).toEqual([]) // never echoed to the sender
    expect(other.sent).toEqual([]) // shows are isolated

    expect(hub.peers('show-1').map((p) => p.connId)).toEqual(['c-ann', 'c-bo'])
    expect(hub.peers('show-2').map((p) => p.connId)).toEqual(['c-zed'])
    expect(hub.peers('show-3')).toEqual([])
  })

  test('peers carry exactly the protocol fields and nothing else about the user', () => {
    const { hub } = setup()
    hub.join('s', new RecordingConn('c1', 'u1', 'Ann'))
    expect(Object.keys(hub.peers('s')[0]).sort()).toEqual(
      [
        'colour',
        'connId',
        'documentId',
        'name',
        'pageIndex',
        'selection',
        'userId',
        'versionId',
      ].sort(),
    )
  })

  test('update for an unknown connection or show is ignored', () => {
    const { hub } = setup()
    const ann = new RecordingConn('c-ann', 'u-ann', 'Ann')
    hub.join('s', ann)
    ann.sent.length = 0
    hub.update('s', 'nope', state())
    hub.update('other-show', 'c-ann', state())
    expect(ann.sent).toEqual([])
    expect(hub.peers('s')[0].documentId).toBeNull()
  })

  test('a peer silent for 15s is dropped on sweep and others get leave; a heartbeat every 5s keeps it', () => {
    const { hub, clock } = setup()
    const quiet = new RecordingConn('c-quiet', 'u1', 'Quiet')
    const beating = new RecordingConn('c-beat', 'u2', 'Beat')
    const watcher = new RecordingConn('c-watch', 'u3', 'Watch')
    hub.join('s', quiet)
    hub.join('s', beating)
    hub.join('s', watcher)

    for (let elapsed = 0; elapsed < PRESENCE_TIMEOUT_MS * 2; elapsed += PRESENCE_HEARTBEAT_MS) {
      clock.advance(PRESENCE_HEARTBEAT_MS)
      hub.update('s', 'c-beat', state())
      hub.update('s', 'c-watch', state())
      hub.sweep()
      if (elapsed < PRESENCE_TIMEOUT_MS - PRESENCE_HEARTBEAT_MS) {
        expect(quiet.closed).toEqual([]) // not yet silent for more than 15s
      }
    }

    expect(quiet.closed).toEqual([{ code: 4408, reason: expect.any(String) }])
    expect(beating.closed).toEqual([])
    expect(watcher.closed).toEqual([])
    expect(hub.peers('s').map((p) => p.connId)).toEqual(['c-beat', 'c-watch'])
    expect(watcher.of('leave')).toEqual([{ type: 'leave', connId: 'c-quiet' }])
    expect(beating.of('leave')).toEqual([{ type: 'leave', connId: 'c-quiet' }])
    expect(quiet.of('leave')).toEqual([])
  })

  test('silence of exactly the timeout is still alive; one millisecond more is dropped', () => {
    const { hub, clock } = setup()
    const c = new RecordingConn('c1', 'u1', 'A')
    hub.join('s', c)
    clock.advance(PRESENCE_TIMEOUT_MS)
    hub.sweep()
    expect(c.closed).toEqual([])
    clock.advance(1)
    hub.sweep()
    expect(c.closed).toHaveLength(1)
  })

  test('the timeout is configurable', () => {
    let t = 0
    const hub = new PresenceHub({ now: () => t, timeoutMs: 100 })
    const c = new RecordingConn('c1', 'u1', 'A')
    hub.join('s', c)
    t = 101
    hub.sweep()
    expect(c.closed).toHaveLength(1)
  })

  test('leave is announced once', () => {
    const { hub, clock } = setup()
    const ann = new RecordingConn('c-ann', 'u-ann', 'Ann')
    const bo = new RecordingConn('c-bo', 'u-bo', 'Bo')
    hub.join('s', ann)
    hub.join('s', bo)
    ann.sent.length = 0

    hub.leave('s', 'c-bo')
    hub.leave('s', 'c-bo')
    hub.leave('elsewhere', 'c-bo')
    expect(ann.sent).toEqual([{ type: 'leave', connId: 'c-bo' }])
    expect(hub.peers('s').map((p) => p.connId)).toEqual(['c-ann'])

    // A swept connection that then reports its own close does not announce twice.
    const cy = new RecordingConn('c-cy', 'u-cy', 'Cy')
    hub.join('s', cy)
    ann.sent.length = 0
    clock.advance(PRESENCE_TIMEOUT_MS + 1)
    hub.update('s', 'c-ann', state())
    hub.sweep()
    hub.leave('s', 'c-cy')
    expect(ann.of('leave')).toEqual([{ type: 'leave', connId: 'c-cy' }])
  })

  test('a connection that throws on send does not stop the fan-out', () => {
    const { hub } = setup()
    const broken = new RecordingConn('c-bad', 'u1', 'Bad')
    broken.send = () => {
      throw new Error('socket closed')
    }
    const ok = new RecordingConn('c-ok', 'u2', 'Ok')
    const sender = new RecordingConn('c-send', 'u3', 'Sender')
    hub.join('s', broken)
    hub.join('s', ok)
    hub.join('s', sender)
    ok.sent.length = 0
    hub.update('s', 'c-send', state())
    expect(ok.of('peer')).toHaveLength(1)
    hub.leave('s', 'c-send')
    expect(ok.of('leave')).toHaveLength(1)
  })

  test("connectionCount counts a user's open connections on one show", () => {
    const { hub } = setup()
    expect(hub.connectionCount('s', 'u1')).toBe(0)
    hub.join('s', new RecordingConn('a', 'u1', 'A'))
    hub.join('s', new RecordingConn('b', 'u1', 'A'))
    hub.join('s', new RecordingConn('c', 'u2', 'B'))
    hub.join('t', new RecordingConn('d', 'u1', 'A'))
    expect(hub.connectionCount('s', 'u1')).toBe(2)
    expect(hub.connectionCount('s', 'u2')).toBe(1)
    expect(hub.connectionCount('t', 'u1')).toBe(1)
    hub.leave('s', 'a')
    expect(hub.connectionCount('s', 'u1')).toBe(1)
  })

  test('closeAll closes every connection with the code and announces no leaves', () => {
    const { hub } = setup()
    const a = new RecordingConn('a', 'u1', 'A')
    const b = new RecordingConn('b', 'u2', 'B')
    const c = new RecordingConn('c', 'u3', 'C')
    hub.join('s', a)
    hub.join('s', b)
    hub.join('t', c)
    a.sent.length = 0
    hub.closeAll(1001, 'bye')
    for (const conn of [a, b, c]) expect(conn.closed).toEqual([{ code: 1001, reason: 'bye' }])
    expect(hub.peers('s')).toEqual([])
    expect(hub.peers('t')).toEqual([])
    expect(a.sent).toEqual([]) // everyone is going; nobody is told about anyone
    hub.closeAll(1001, 'bye')
    expect(a.closed).toHaveLength(1)
  })

  test('the same user in two tabs is two peers with the same colour', () => {
    const { hub } = setup()
    hub.join('s', new RecordingConn('tab1', 'u1', 'A'))
    hub.join('s', new RecordingConn('tab2', 'u1', 'A'))
    const peers = hub.peers('s')
    expect(peers.map((p) => p.connId)).toEqual(['tab1', 'tab2'])
    expect(peers[0].colour).toBe(peers[1].colour)
  })
})
