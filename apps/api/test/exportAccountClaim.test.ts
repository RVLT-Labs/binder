import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AppEnv } from '../src/app'
import { AppError } from '../src/errors'
import { exportRoutes } from '../src/routes/exports'
import { createExportRecord } from '../src/services'
import { assertCanExport } from '../src/services/exports'
import { readUpload } from '../src/upload/multipart'

vi.mock('../src/services', () => ({
  createExportRecord: vi.fn(async () => ({ id: 'synthetic-export' })),
  listExportRecords: vi.fn(),
}))
vi.mock('../src/services/exports', () => ({ assertCanExport: vi.fn(async () => {}) }))
vi.mock('../src/upload/multipart', () => ({
  MAX_UPLOAD_BYTES: 1000,
  readUpload: vi.fn(async () => ({
    fields: {
      meta: JSON.stringify({
        id: 'synthetic-export',
        kind: 'pdf-script',
        filename: 'A.pdf',
        layerSelection: [{ kind: 'department', id: 'shared' }],
      }),
    },
    file: { stream: Readable.from('%PDF-disposable') },
  })),
}))

let signedIn = true
const getSession = vi.fn(async () =>
  signedIn ? { user: { id: 'B', email: 'b@example.invalid', name: 'B' } } : null,
)
const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('deps', {
    auth: { api: { getSession } },
    config: { APP_ORIGIN: 'http://localhost' },
    db: {},
    blobs: {},
  } as unknown as AppEnv['Variables']['deps'])
  await next()
})
app.onError((err, c) =>
  err instanceof AppError
    ? new Response(JSON.stringify({ code: err.code }), { status: err.status })
    : c.json({ error: err.message }, 500),
)
app.route('/api', exportRoutes)
beforeEach(() => {
  vi.clearAllMocks()
  signedIn = true
})
const request = (expected?: string) =>
  app.request('/api/shows/shared/exports', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      ...(expected === undefined ? {} : { 'X-Binder-Expected-User': expected }),
    },
  })

test('P1 actual authentication rejects A expected account with B session before reading/storing upload', async () => {
  expect((await request('A')).status).toBe(412)
  expect(getSession).toHaveBeenCalled()
  expect(assertCanExport).not.toHaveBeenCalled()
  expect(readUpload).not.toHaveBeenCalled()
  expect(createExportRecord).not.toHaveBeenCalled()
})
test('P1 matching expectation and original clients still use normal authorization and upload', async () => {
  expect((await request('B')).status).toBe(201)
  expect((await request()).status).toBe(201)
  expect(assertCanExport).toHaveBeenCalledTimes(2)
  expect(createExportRecord).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    { userId: 'B', via: 'web', agent: null },
    expect.objectContaining({ id: 'synthetic-export' }),
  )
})
test('P1 expected account header cannot authenticate or bypass same-origin checks', async () => {
  signedIn = false
  expect((await request('B')).status).toBe(401)
  signedIn = true
  expect(
    (
      await app.request('/api/shows/shared/exports', {
        method: 'POST',
        headers: { origin: 'https://foreign.invalid', 'X-Binder-Expected-User': 'B' },
      })
    ).status,
  ).toBe(403)
  expect(readUpload).not.toHaveBeenCalled()
  expect(createExportRecord).not.toHaveBeenCalled()
})
