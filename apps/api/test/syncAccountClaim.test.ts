import { Hono } from 'hono'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AppEnv } from '../src/app'
import { AppError } from '../src/errors'
import { readJson } from '../src/routes/json'
import { sync } from '../src/routes/sync'
import { applyCrudBatch } from '../src/sync/apply'
import { mintPowerSyncToken } from '../src/sync/token'

// Only session lookup and storage/token boundaries are synthetic. The mounted production route,
// requireSession, origin check and JSON validation execute normally. No backend or browser login.
vi.mock('../src/sync/apply', () => ({
  applyCrudBatch: vi.fn(async () => ({ applied: 1, rejected: [] })),
}))
vi.mock('../src/sync/token', () => ({
  mintPowerSyncToken: vi.fn(async () => ({ token: 'synthetic', expiresAt: new Date(0) })),
}))
vi.mock('../src/routes/json', async (original) => {
  const actual = await original<typeof import('../src/routes/json')>()
  return { ...actual, readJson: vi.fn(actual.readJson) }
})
let account: string | null = 'B'
const getSession = vi.fn(async () =>
  account ? { user: { id: account, email: 'synthetic@example.invalid', name: account } } : null,
)
const storage = {}
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('deps', {
    auth: { api: { getSession } },
    config: { APP_ORIGIN: 'http://localhost', POWERSYNC_URL: 'http://synthetic.invalid' },
    db: storage,
  } as unknown as AppEnv['Variables']['deps'])
  await next()
})
app.onError((err, c) =>
  err instanceof AppError
    ? new Response(JSON.stringify({ code: err.code }), { status: err.status })
    : c.json({ error: err.message }, 500),
)
app.route('/api', sync)
beforeEach(() => {
  vi.clearAllMocks()
  account = 'B'
})
const body = JSON.stringify({
  batchId: 'original-device-7',
  chunk: { index: 1, count: 2 },
  entries: [{ table: 'shows', id: 'both-can-edit', op: 'PATCH', data: { title: 'A edit' } }],
})
function upload(expected?: string, origin = 'http://localhost', payload = body) {
  return app.request('/api/sync/upload', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(expected === undefined ? {} : { 'X-Binder-Expected-User': expected }),
    },
    body: payload,
  })
}

test('round4 sync authenticates then rejects a changed account before parsing or processing any chunk', async () => {
  const response = await upload('A', 'http://localhost', '{invalid JSON')
  expect(response.status).toBe(412)
  expect(getSession).toHaveBeenCalledOnce()
  expect(readJson).not.toHaveBeenCalled()
  expect(applyCrudBatch).not.toHaveBeenCalled()
})

test('round4 matching sync expectation and legacy clients keep normal actor, validation and replay namespace', async () => {
  expect((await upload('B')).status).toBe(200)
  expect((await upload()).status).toBe(200)
  expect(applyCrudBatch).toHaveBeenCalledTimes(2)
  expect(applyCrudBatch).toHaveBeenCalledWith(
    storage,
    { userId: 'B', via: 'sync', agent: null },
    {
      ...JSON.parse(body),
      batchId: 'B:original-device-7',
    },
  )
  expect((await upload('B', 'http://localhost', '{invalid')).status).toBe(400)
  expect(applyCrudBatch).toHaveBeenCalledTimes(2)
})

test('round4 expected account cannot authenticate, bypass origin, or turn mismatched CRUD into rejections', async () => {
  account = null
  expect((await upload('B')).status).toBe(401)
  account = 'B'
  expect((await upload('B', 'https://foreign.invalid')).status).toBe(403)
  expect((await upload('A')).status).toBe(412)
  expect(readJson).not.toHaveBeenCalled()
  expect(applyCrudBatch).not.toHaveBeenCalled()
})

test('round4 token minting also refuses a changed account after session authentication', async () => {
  const request = (expected: string) =>
    app.request('/api/sync/token', {
      headers: { 'X-Binder-Expected-User': expected },
    })
  expect((await request('A')).status).toBe(412)
  expect(mintPowerSyncToken).not.toHaveBeenCalled()
  expect((await request('B')).status).toBe(200)
  account = null
  expect((await request('B')).status).toBe(401)
  expect(mintPowerSyncToken).toHaveBeenCalledTimes(1)
})
