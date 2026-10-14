import { Hono } from 'hono'
import type { AppEnv } from '../app'

export const health = new Hono<AppEnv>().get('/health', (c) => c.json({ ok: true }))
