import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'

export const me = new Hono<AppEnv>()

me.get('/me', requireUser, (c) => c.json({ user: c.var.user }))
