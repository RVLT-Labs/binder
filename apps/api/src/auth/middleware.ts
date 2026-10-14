import type { MiddlewareHandler } from 'hono'
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

/** Session cookie only. Use for routes a personal access token must not reach (token management). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await c.var.deps.auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) throw unauthenticated()
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
