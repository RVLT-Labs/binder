import { user as userTable } from '@binder/db'
import type { Actor } from '@binder/shared'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import { authenticateToken } from '../services'
import type { ShowScope } from '../services/tokens'

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by `mcpAuth` for the /mcp route. */
    mcpAuth: AuthInfo
  }
}

/** PATs without an expiry still need an AuthInfo expiry; ten years is "never" for one request. */
const NO_EXPIRY_SECONDS = 10 * 365 * 24 * 60 * 60

const SCOPE_PREFIX = 'shows:'

export function scopesFor(showScope: ShowScope): string[] {
  return showScope === '*' ? [`${SCOPE_PREFIX}*`] : showScope.map((id) => SCOPE_PREFIX + id)
}

function showScopeOf(scopes: string[]): ShowScope {
  const ids = scopes
    .filter((s) => s.startsWith(SCOPE_PREFIX))
    .map((s) => s.slice(SCOPE_PREFIX.length))
  return ids.includes('*') ? '*' : ids
}

function unauthorized(c: Parameters<MiddlewareHandler<AppEnv>>[0], presented: boolean) {
  const challenge = presented
    ? 'Bearer realm="binder", error="invalid_token"'
    : 'Bearer realm="binder"'
  return c.json(
    { error: 'unauthenticated', message: 'A valid personal access token is required' },
    401,
    { 'WWW-Authenticate': challenge },
  )
}

/**
 * Authenticates `Authorization: Bearer bnd_...` for /mcp and stores the MCP `AuthInfo`. Anything
 * else is a 401 with a `WWW-Authenticate: Bearer` challenge (no OAuth in version one).
 */
export const mcpAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
  if (!match) return unauthorized(c, false)
  const { db } = c.var.deps
  const auth = await authenticateToken(db, match[1])
  if (!auth) return unauthorized(c, true)
  const [u] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, auth.userId))
  if (!u) return unauthorized(c, true)
  c.set('mcpAuth', {
    token: match[1],
    clientId: auth.tokenId,
    scopes: scopesFor(auth.showScope),
    expiresAt: auth.expiresAt
      ? Math.floor(auth.expiresAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000) + NO_EXPIRY_SECONDS,
    extra: { userId: auth.userId },
  })
  await next()
}

/** The token's user and show scope, as recorded by `mcpAuth`. */
export interface Principal {
  userId: string
  showScope: ShowScope
  /** The HTTP User-Agent, the fallback when the client does not declare itself. */
  userAgent: string | null
}

export function principalFrom(authInfo: AuthInfo, request: Request | undefined): Principal {
  const userId = authInfo.extra?.userId
  if (typeof userId !== 'string') throw new Error('MCP authInfo carries no userId')
  return {
    userId,
    showScope: showScopeOf(authInfo.scopes),
    userAgent: request?.headers.get('user-agent') ?? null,
  }
}

/** `name/version` as the client declared it, for change log attribution (spec 3.10). */
function describeClient(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null
  const { name, version } = info as { name?: unknown; version?: unknown }
  if (typeof name !== 'string' || name === '') return null
  return typeof version === 'string' && version !== '' ? `${name}/${version}` : name
}

/**
 * The actor for one MCP request: the token's user, `via: 'mcp'`, its show scope (enforced by
 * `requireShowRole` in every service), and as agent the client's declared name and version, else
 * its User-Agent.
 */
export function actorFor(principal: Principal, clientInfo: unknown): Actor {
  return {
    userId: principal.userId,
    via: 'mcp',
    agent: (describeClient(clientInfo) ?? principal.userAgent)?.slice(0, 200) ?? null,
    showScope: principal.showScope,
  }
}
