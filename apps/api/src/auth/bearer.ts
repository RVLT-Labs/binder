import { user as userTable } from '@binder/db'
import { eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import { unauthenticated } from '../errors'
import { authenticateToken } from '../services'

/**
 * Authenticates `Authorization: Bearer bnd_...`. Any missing, malformed, unknown, revoked or
 * expired token is a 401; there is no fall-through to anonymous. `requireUser` tries the session
 * cookie first and only then runs this.
 */
export const bearerAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
  if (!match) throw unauthenticated()
  const { db } = c.var.deps
  const auth = await authenticateToken(db, match[1])
  if (!auth) throw unauthenticated()
  const [u] = await db
    .select({ id: userTable.id, email: userTable.email, name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, auth.userId))
  if (!u) throw unauthenticated()
  c.set('user', u)
  c.set('actor', {
    userId: u.id,
    via: 'mcp',
    agent: c.req.header('user-agent') ?? null,
    showScope: auth.showScope,
  })
  await next()
}
