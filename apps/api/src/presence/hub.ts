import {
  EMPTY_PRESENCE_STATE,
  PRESENCE_TIMEOUT_MS,
  type PresencePeer,
  type PresenceState,
  presenceColour,
  type ServerMessage,
} from '@binder/shared'

/** Close code for a connection that went silent. */
export const PRESENCE_CLOSE_TIMEOUT = 4408

/** One open socket as the hub sees it. The route adapts a WebSocket to this. */
export interface PresenceConn {
  id: string
  userId: string
  name: string
  send(msg: ServerMessage): void
  close(code: number, reason: string): void
}

interface Entry {
  conn: PresenceConn
  state: PresenceState
  lastSeen: number
}

/**
 * Who is in each show's binder (spec 3.9). Pure in-memory fan-out: no sockets, no clocks of its own
 * (the clock is injected), so the heartbeat and timeout rules are testable with a fake one. Shows
 * are isolated from each other. A connection leaves exactly once however it ends (close, error,
 * membership removal, or silence), and a connection that fails to send never stops the fan-out.
 */
export class PresenceHub {
  readonly #shows = new Map<string, Map<string, Entry>>()
  readonly #now: () => number
  readonly #timeoutMs: number

  constructor(opts: { now?: () => number; timeoutMs?: number } = {}) {
    this.#now = opts.now ?? Date.now
    this.#timeoutMs = opts.timeoutMs ?? PRESENCE_TIMEOUT_MS
  }

  /** Welcome the connection with the others already here, and tell them about it. */
  join(showId: string, conn: PresenceConn): void {
    let show = this.#shows.get(showId)
    if (!show) {
      show = new Map()
      this.#shows.set(showId, show)
    }
    const entry: Entry = { conn, state: { ...EMPTY_PRESENCE_STATE }, lastSeen: this.#now() }
    const others = [...show.values()].map(peerOf)
    show.set(conn.id, entry)
    this.#send(conn, { type: 'welcome', connId: conn.id, peers: others })
    this.#fanOut(show, conn.id, { type: 'peer', peer: peerOf(entry) })
  }

  /** Store the state, stamp the connection as alive, and tell everyone else in the show. */
  update(showId: string, connId: string, state: PresenceState): void {
    const show = this.#shows.get(showId)
    const entry = show?.get(connId)
    if (!show || !entry) return
    entry.state = { ...state }
    entry.lastSeen = this.#now()
    this.#fanOut(show, connId, { type: 'peer', peer: peerOf(entry) })
  }

  /** Remove the connection and tell the others. A second call for the same connection does nothing. */
  leave(showId: string, connId: string): void {
    const show = this.#shows.get(showId)
    if (!show?.delete(connId)) return
    if (show.size === 0) this.#shows.delete(showId)
    else this.#fanOut(show, connId, { type: 'leave', connId })
  }

  /** Drop every connection silent for more than the timeout: close it with 4408 and announce leave. */
  sweep(): void {
    const cutoff = this.#now() - this.#timeoutMs
    const silent: { showId: string; conn: PresenceConn }[] = []
    for (const [showId, show] of this.#shows) {
      for (const entry of show.values()) {
        if (entry.lastSeen < cutoff) silent.push({ showId, conn: entry.conn })
      }
    }
    for (const { showId, conn } of silent) {
      // Leave first: closing may call back into leave, which then finds nothing to do.
      this.leave(showId, conn.id)
      try {
        conn.close(PRESENCE_CLOSE_TIMEOUT, 'presence timeout')
      } catch {
        // already gone
      }
    }
  }

  /**
   * Shutdown: close every connection with `code` and forget them all. Nobody is told about anyone
   * leaving, because everybody is. Each connection's own cleanup then finds nothing left to do.
   */
  closeAll(code: number, reason: string): void {
    const conns = [...this.#shows.values()].flatMap((show) => [...show.values()].map((e) => e.conn))
    this.#shows.clear()
    for (const conn of conns) {
      try {
        conn.close(code, reason)
      } catch {
        // already gone
      }
    }
  }

  peers(showId: string): PresencePeer[] {
    return [...(this.#shows.get(showId)?.values() ?? [])].map(peerOf)
  }

  /** Who is in the show right now, once per user (a user with two tabs counts once), in join order. */
  occupants(showId: string): { userId: string; name: string }[] {
    const seen = new Map<string, string>()
    for (const { conn } of this.#shows.get(showId)?.values() ?? []) {
      if (!seen.has(conn.userId)) seen.set(conn.userId, conn.name)
    }
    return [...seen].map(([userId, name]) => ({ userId, name }))
  }

  /** How many connections this user holds open on this show. */
  connectionCount(showId: string, userId: string): number {
    let count = 0
    for (const entry of this.#shows.get(showId)?.values() ?? []) {
      if (entry.conn.userId === userId) count++
    }
    return count
  }

  #fanOut(show: Map<string, Entry>, exceptConnId: string, msg: ServerMessage): void {
    for (const [id, entry] of show) {
      if (id !== exceptConnId) this.#send(entry.conn, msg)
    }
  }

  #send(conn: PresenceConn, msg: ServerMessage): void {
    try {
      conn.send(msg)
    } catch {
      // A dead socket is cleaned up by its own close event or the sweep.
    }
  }
}

function peerOf({ conn, state }: Entry): PresencePeer {
  return {
    connId: conn.id,
    userId: conn.userId,
    name: conn.name,
    colour: presenceColour(conn.userId),
    ...state,
  }
}
