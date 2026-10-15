import { user } from '@binder/db'
import {
  clientMessageSchema,
  newId,
  PRESENCE_MAX_CONNECTIONS_PER_USER,
  PRESENCE_MAX_FRAME_BYTES,
  PRESENCE_MAX_MESSAGES_PER_SECOND,
  type ServerMessage,
} from '@binder/shared'
import type { NodeWebSocket } from '@hono/node-ws'
import { eq } from 'drizzle-orm'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import { requireSession } from '../auth/middleware'
import { appOrigin } from '../config'
import { forbidden, unauthenticated } from '../errors'
import type { PresenceConn } from '../presence/hub'
import { getShowRole, requireShowRole } from '../services/tenancy'

/** How often a connection's membership is re-read when `presenceOptions.recheckMs` is not set. */
export const PRESENCE_RECHECK_MS = 30_000

/** Close codes. 1008 and 1009 are the standard policy and message-too-big codes. */
export const PRESENCE_CLOSE_POLICY = 1008
export const PRESENCE_CLOSE_TOO_BIG = 1009
export const PRESENCE_CLOSE_SESSION_ENDED = 4401
export const PRESENCE_CLOSE_MEMBERSHIP_REMOVED = 4403
/** Lost a race for the last connection slot between the pre-upgrade check and the upgrade. */
export const PRESENCE_CLOSE_TOO_MANY = 4429

/** One flood second: more than this many frames inside it closes the connection. */
const FLOOD_FRAMES_PER_SECOND = PRESENCE_MAX_MESSAGES_PER_SECOND * 5

/**
 * The handshake must come from the app's own origin. Browsers do not apply the same-origin policy
 * to WebSockets and *.rvlt.app hosts share a site, so without this another page could ride the
 * session cookie. A handshake with no Origin is refused too: every browser sends one.
 */
const requireAppOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header('origin') !== appOrigin(c.var.deps.config)) {
    throw forbidden('Cross-origin request refused')
  }
  await next()
}

/** Membership, then the per-user connection cap: the last two checks before a socket exists. */
const requireSlot: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { deps, actor } = c.var
  // biome-ignore lint/style/noNonNullAssertion: requireSession always sets actor
  const who = actor!
  const showId = c.req.param('showId') ?? ''
  await requireShowRole(deps.db, who, showId, 'viewer')
  if (deps.presence.connectionCount(showId, who.userId) >= PRESENCE_MAX_CONNECTIONS_PER_USER) {
    return c.json(
      { error: 'too_many_connections', message: 'Too many open presence connections' },
      429,
    )
  }
  await next()
}

/** A token bucket: `capacity` tokens, refilled at `perSecond`. */
class TokenBucket {
  #tokens: number
  #last = Date.now()
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.#tokens = capacity
  }
  take(): boolean {
    const now = Date.now()
    this.#tokens = Math.min(
      this.capacity,
      this.#tokens + ((now - this.#last) / 1000) * this.perSecond,
    )
    this.#last = now
    if (this.#tokens < 1) return false
    this.#tokens -= 1
    return true
  }
}

const frameBytes = (data: unknown): number =>
  typeof data === 'string'
    ? Buffer.byteLength(data)
    : data instanceof ArrayBuffer
      ? data.byteLength
      : 0

/**
 * GET /api/shows/:showId/presence: the presence WebSocket (spec 3.9). Everything that can refuse
 * runs before the upgrade, so a refused client gets a plain HTTP status and no socket exists.
 */
export function createPresenceRoutes(
  upgradeWebSocket: NodeWebSocket['upgradeWebSocket'],
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>()

  routes.get(
    '/shows/:showId/presence',
    requireAppOrigin,
    requireSession,
    requireSlot,
    upgradeWebSocket(async (context) => {
      const c = context as unknown as Context<AppEnv>
      const { deps, actor } = c.var
      // biome-ignore lint/style/noNonNullAssertion: requireSession always sets actor
      const { userId } = actor!
      const showId = c.req.param('showId') ?? ''
      const hub = deps.presence
      const recheckMs = deps.presenceOptions?.recheckMs ?? PRESENCE_RECHECK_MS
      // The upgrade request's credentials, kept to ask again later whether the session still lives.
      const headers = new Headers(c.req.raw.headers)

      // The display name is read from the user table now, never taken from the client.
      const [row] = await deps.db.select({ name: user.name }).from(user).where(eq(user.id, userId))
      if (!row) throw unauthenticated()

      const connId = newId()
      const bucket = new TokenBucket(
        PRESENCE_MAX_MESSAGES_PER_SECOND,
        PRESENCE_MAX_MESSAGES_PER_SECOND,
      )
      let windowStart = Date.now()
      let windowFrames = 0
      let recheck: ReturnType<typeof setInterval> | undefined
      let checking = false
      let over = false
      let closeSocket: (code: number, reason: string) => void = () => {}

      /** Ends the connection's presence exactly once: timers off, hub told, never announced twice. */
      const finish = () => {
        over = true
        if (recheck) clearInterval(recheck)
        recheck = undefined
        hub.leave(showId, connId)
      }
      /** Leave now, so peers see it at once, then close the socket with `code`. */
      const shut = (code: number, reason: string) => {
        if (over) return
        finish()
        closeSocket(code, reason)
      }

      return {
        onOpen(_event, ws) {
          closeSocket = (code, reason) => ws.close(code, reason)
          const conn: PresenceConn = {
            id: connId,
            userId,
            name: row.name,
            send: (msg: ServerMessage) => ws.send(JSON.stringify(msg)),
            close: (code, reason) => {
              finish()
              ws.close(code, reason)
            },
          }
          // Two upgrades can pass the pre-upgrade count together; the last one in loses here.
          if (hub.connectionCount(showId, userId) >= PRESENCE_MAX_CONNECTIONS_PER_USER) {
            over = true
            ws.close(PRESENCE_CLOSE_TOO_MANY, 'too many connections')
            return
          }
          hub.join(showId, conn)
          recheck = setInterval(async () => {
            if (checking || over) return
            checking = true
            try {
              // A socket outlives the request that opened it, and heartbeats defeat the sweep, so
              // sign-out, revocation and expiry are noticed here, along with a removed membership.
              if (!(await deps.auth.api.getSession({ headers }))) {
                shut(PRESENCE_CLOSE_SESSION_ENDED, 'session ended')
                return
              }
              const role = await getShowRole(deps.db, userId, showId)
              if (!role) shut(PRESENCE_CLOSE_MEMBERSHIP_REMOVED, 'membership removed')
            } catch (err) {
              // A database blip must not drop everyone (session or membership); the next tick tries again.
              console.error('presence recheck failed', err)
            } finally {
              checking = false
            }
          }, recheckMs)
        },

        onMessage(event) {
          if (over) return
          // Count frames, not bytes: more than five times the rate in one second is a flood.
          const now = Date.now()
          if (now - windowStart >= 1000) {
            windowStart = now
            windowFrames = 0
          }
          if (++windowFrames > FLOOD_FRAMES_PER_SECOND) {
            shut(PRESENCE_CLOSE_POLICY, 'rate limit exceeded')
            return
          }
          // Backstop: wss.options.maxPayload (app.ts) normally closes an oversized frame with 1009 first.
          if (frameBytes(event.data) > PRESENCE_MAX_FRAME_BYTES) {
            shut(PRESENCE_CLOSE_TOO_BIG, 'frame too large')
            return
          }
          if (!bucket.take()) return // over 20 a second: dropped
          if (typeof event.data !== 'string') return
          let json: unknown
          try {
            json = JSON.parse(event.data)
          } catch {
            return // malformed: ignored, not a close
          }
          const parsed = clientMessageSchema.safeParse(json)
          if (!parsed.success) return
          hub.update(showId, connId, parsed.data.state)
        },

        onClose() {
          finish()
        },
        onError() {
          finish()
        },
      }
    }),
    (c) => c.json({ error: 'upgrade_required', message: 'Expected a WebSocket upgrade' }, 426),
  )

  return routes
}
