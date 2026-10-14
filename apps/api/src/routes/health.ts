import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { magicLinkEnabled } from '../config'

/** Liveness, plus the sign-in options the login page may offer. */
export const health = new Hono<AppEnv>().get('/health', (c) =>
  c.json({ ok: true, magicLink: magicLinkEnabled(c.var.deps.config) }),
)
