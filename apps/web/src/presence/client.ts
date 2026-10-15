import {
  type ClientMessage,
  EMPTY_PRESENCE_STATE,
  PRESENCE_HEARTBEAT_MS,
  type PresencePeer,
  type PresenceSelection,
  type PresenceState,
  type ServerMessage,
} from '@binder/shared'

/** No more than one state message per this long: a drag of the selection sends once per window. */
export const PRESENCE_SEND_INTERVAL_MS = 250
export const PRESENCE_BACKOFF_START_MS = 1000
export const PRESENCE_BACKOFF_MAX_MS = 30_000
/**
 * Close codes after which reconnecting is pointless until the page reloads or the user signs in
 * again: the session has ended (4401) or the user is no longer a member of the show (4403).
 */
export const PRESENCE_TERMINAL_CODES: readonly number[] = [4401, 4403]

const OPEN = 1

export interface PresenceClientOptions {
  /** The presence WebSocket URL, `ws:` or `wss:`. */
  url: string
  WebSocketImpl?: typeof WebSocket
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export type PresenceListener = (peers: PresencePeer[], connected: boolean) => void

export interface PresenceClient {
  /** Sets what this connection says about itself; sent on change (throttled) and as a heartbeat. */
  setState(state: PresenceState): void
  /**
   * Calls `fn` now and on every change with the other connections in the show, oldest update
   * first, and whether the socket is open. Returns the unsubscribe.
   */
  subscribe(fn: PresenceListener): () => void
  /** Closes the socket and stops reconnecting. Final. */
  close(): void
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const orNull = (v: unknown): boolean => v === null || v === undefined

function readPeer(raw: unknown): PresencePeer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (!isId(p.connId) || !isId(p.userId) || typeof p.name !== 'string') return null
  const sel = p.selection as Record<string, unknown> | null | undefined
  let selection: PresenceSelection | null
  if (sel === null || sel === undefined) selection = null
  else if (
    typeof sel === 'object' &&
    (sel.table === 'cues' || sel.table === 'annotations') &&
    isId(sel.id)
  ) {
    selection = { table: sel.table, id: sel.id }
  } else return null
  const text = (v: unknown) => (isId(v) ? v : orNull(v) ? null : undefined)
  const documentId = text(p.documentId)
  const versionId = text(p.versionId)
  const pageIndex =
    typeof p.pageIndex === 'number' && Number.isInteger(p.pageIndex) && p.pageIndex >= 0
      ? p.pageIndex
      : orNull(p.pageIndex)
        ? null
        : undefined
  if (documentId === undefined || versionId === undefined || pageIndex === undefined) return null
  return {
    connId: p.connId,
    userId: p.userId,
    name: p.name,
    // The colour goes into styles: only a plain hex colour is used.
    colour: typeof p.colour === 'string' && /^#[0-9a-f]{6}$/i.test(p.colour) ? p.colour : '#6b7280',
    documentId,
    versionId,
    pageIndex,
    selection,
  }
}

function readMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (m.type === 'welcome' && isId(m.connId) && Array.isArray(m.peers)) {
    const peers = m.peers.map(readPeer).filter((p): p is PresencePeer => p !== null)
    return { type: 'welcome', connId: m.connId, peers }
  }
  if (m.type === 'peer') {
    const peer = readPeer(m.peer)
    return peer ? { type: 'peer', peer } : null
  }
  if (m.type === 'leave' && isId(m.connId)) return { type: 'leave', connId: m.connId }
  return null
}

const sameState = (a: PresenceState, b: PresenceState): boolean =>
  a.documentId === b.documentId &&
  a.versionId === b.versionId &&
  a.pageIndex === b.pageIndex &&
  a.selection?.table === b.selection?.table &&
  a.selection?.id === b.selection?.id

/**
 * The presence connection for one show (spec 3.9). It says where the user is, throttled, and again
 * every PRESENCE_HEARTBEAT_MS so the server keeps it; it hears who else is here. Best-effort: a
 * dropped socket is retried with backoff and never surfaces as an error, and the peers of a socket
 * that is gone are dropped rather than shown stale.
 */
export function createPresenceClient(opts: PresenceClientOptions): PresenceClient {
  const setTimer = opts.setTimer ?? setTimeout
  const clearTimer = opts.clearTimer ?? clearTimeout
  type Timer = ReturnType<typeof setTimeout>

  let state: PresenceState = { ...EMPTY_PRESENCE_STATE }
  let socket: WebSocket | null = null
  let ownConnId: string | null = null
  let stopped = false
  let connected = false
  let delay = PRESENCE_BACKOFF_START_MS
  let pending = false
  let reconnectTimer: Timer | null = null
  let heartbeatTimer: Timer | null = null
  let windowTimer: Timer | null = null
  /** In update order: re-setting a key moves it to the end. */
  const peers = new Map<string, PresencePeer>()
  const listeners = new Set<PresenceListener>()

  const emit = () => {
    const list = [...peers.values()]
    for (const fn of [...listeners]) fn(list, connected)
  }

  function clearTimers() {
    for (const t of [reconnectTimer, heartbeatTimer, windowTimer]) if (t !== null) clearTimer(t)
    reconnectTimer = heartbeatTimer = windowTimer = null
  }

  function send() {
    if (!socket || socket.readyState !== OPEN) return
    pending = false
    const msg: ClientMessage = { type: 'state', state }
    try {
      socket.send(JSON.stringify(msg))
    } catch {
      return
    }
    // The next message may follow in 250 ms; with nothing to say the heartbeat follows in 5 s.
    if (windowTimer !== null) clearTimer(windowTimer)
    windowTimer = setTimer(() => {
      windowTimer = null
      if (pending) send()
    }, PRESENCE_SEND_INTERVAL_MS)
    if (heartbeatTimer !== null) clearTimer(heartbeatTimer)
    heartbeatTimer = setTimer(() => {
      heartbeatTimer = null
      send()
    }, PRESENCE_HEARTBEAT_MS)
  }

  function detach(ws: WebSocket) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    try {
      ws.close()
    } catch {
      // already closed
    }
  }

  /** The socket is gone, for `code` (undefined after an error): drop the peers, then retry or stop. */
  function lost(ws: WebSocket, code: number | undefined) {
    if (socket !== ws) return
    socket = null
    detach(ws)
    clearTimers()
    pending = false
    ownConnId = null
    connected = false
    peers.clear()
    emit()
    if (stopped) return
    if (code !== undefined && PRESENCE_TERMINAL_CODES.includes(code)) {
      stopped = true
      return
    }
    reconnectTimer = setTimer(() => {
      reconnectTimer = null
      connect()
    }, delay)
    delay = Math.min(delay * 2, PRESENCE_BACKOFF_MAX_MS)
  }

  function onMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      ownConnId = msg.connId
      delay = PRESENCE_BACKOFF_START_MS
      peers.clear()
      for (const p of msg.peers) if (p.connId !== ownConnId) peers.set(p.connId, p)
    } else if (msg.type === 'peer') {
      if (msg.peer.connId === ownConnId) return
      peers.delete(msg.peer.connId)
      peers.set(msg.peer.connId, msg.peer)
    } else if (!peers.delete(msg.connId)) return
    emit()
  }

  function connect() {
    if (stopped) return
    let ws: WebSocket
    try {
      ws = new (opts.WebSocketImpl ?? WebSocket)(opts.url)
    } catch {
      // A malformed URL or a blocked constructor: treat it like any other failed attempt.
      reconnectTimer = setTimer(() => {
        reconnectTimer = null
        connect()
      }, delay)
      delay = Math.min(delay * 2, PRESENCE_BACKOFF_MAX_MS)
      return
    }
    socket = ws
    ws.onopen = () => {
      if (socket !== ws) return
      connected = true
      emit()
      send()
    }
    ws.onmessage = (e) => {
      if (socket !== ws) return
      const msg = readMessage(e.data)
      if (msg) onMessage(msg)
    }
    ws.onerror = () => lost(ws, undefined)
    ws.onclose = (e) => lost(ws, e.code)
  }

  connect()

  return {
    setState(next) {
      if (sameState(next, state)) return
      state = { ...next, selection: next.selection ? { ...next.selection } : null }
      if (stopped || !socket || socket.readyState !== OPEN) return
      if (windowTimer === null) send()
      else pending = true
    },
    subscribe(fn) {
      listeners.add(fn)
      fn([...peers.values()], connected)
      return () => {
        listeners.delete(fn)
      }
    },
    close() {
      if (stopped && !socket) {
        listeners.clear()
        return
      }
      stopped = true
      clearTimers()
      const ws = socket
      socket = null
      if (ws) detach(ws)
      pending = false
      connected = false
      peers.clear()
      emit()
      listeners.clear()
    },
  }
}
