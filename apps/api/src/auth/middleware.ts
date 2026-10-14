import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import { forbidden, unauthenticated } from '../errors'

/** Public sign-up is closed unless ALLOW_SIGNUP is true; users are created by the CLI. */
export const signUpGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'POST' && c.req.path === '/api/auth/sign-up/email') {
    if (!c.var.deps.config.ALLOW_SIGNUP) throw forbidden('Sign-up is disabled')
  }
  await next()
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await c.var.deps.auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) throw unauthenticated()
  const { id, email, name } = session.user
  c.set('user', { id, email, name })
  c.set('actor', { userId: id, via: 'web', agent: null })
  await next()
}
