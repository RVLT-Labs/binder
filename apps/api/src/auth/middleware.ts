import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import { forbidden, unauthenticated } from '../errors'
import { bearerAuth } from './bearer'

/** Public sign-up is closed unless ALLOW_SIGNUP is true; users are created by the CLI. */
export const signUpGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'POST' && c.req.path === '/api/auth/sign-up/email') {
    if (!c.var.deps.config.ALLOW_SIGNUP) throw forbidden('Sign-up is disabled')
  }
  await next()
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Cross-site request forgery guard for cookie-authenticated requests. The session cookie is
 * SameSite=Lax, which blocks cross-site POSTs but not same-site ones, and every *.rvlt.app host is
 * the same site as the app. So an unsafe method must come from the app's own origin: `Origin` equal
 * to APP_ORIGIN or, when a browser leaves Origin out, `Sec-Fetch-Site: same-origin`. Bearer requests
 * carry no ambient credential and are not checked.
 */
export function assertSameOrigin(c: Context<AppEnv>): void {
  if (!UNSAFE_METHODS.has(c.req.method)) return
  const origin = c.req.header('origin')
  if (origin !== undefined) {
    if (origin === new URL(c.var.deps.config.APP_ORIGIN).origin) return
    throw forbidden('Cross-origin request refused')
  }
  if (c.req.header('sec-fetch-site') === 'same-origin') return
  throw forbidden('Cross-origin request refused')
}

/** Session cookie only. Use for routes a personal access token must not reach (token management). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await c.var.deps.auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) throw unauthenticated()
  assertSameOrigin(c)
  const { id, email, name } = session.user
  c.set('user', { id, email, name })
  c.set('actor', { userId: id, via: 'web', agent: null })
  await next()
}

/** Session cookie first, then a bearer personal access token; otherwise 401. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await c.var.deps.auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return bearerAuth(c, next)
  return requireSession(c, next)
}
