import { HTTPException } from 'hono/http-exception'
import { expect, test } from 'vitest'
import { createApp } from '../src/app'
import { invalid, notFound } from '../src/errors'
import { testDeps } from './helpers'

test('GET /api/health returns ok', async () => {
  const app = createApp(await testDeps())
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, magicLink: true })
})

test('AppError maps to its status and code', async () => {
  const app = createApp(await testDeps())
  app.get('/api/nf', () => {
    throw notFound('no such thing')
  })
  app.get('/api/bad', () => {
    throw invalid('bad input')
  })
  const nf = await app.request('/api/nf')
  expect(nf.status).toBe(404)
  expect(await nf.json()).toEqual({ error: 'not_found', message: 'no such thing' })
  const bad = await app.request('/api/bad')
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'invalid', message: 'bad input' })
})

test('unknown errors become 500 without leaking details', async () => {
  const app = createApp(await testDeps())
  app.get('/api/boom', () => {
    throw new Error('secret detail')
  })
  const orig = console.error
  console.error = () => {}
  try {
    const res = await app.request('/api/boom')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  } finally {
    console.error = orig
  }
})

test('HTTPException keeps its status', async () => {
  const app = createApp(await testDeps())
  app.get('/api/big', () => {
    throw new HTTPException(413, { message: 'too big' })
  })
  const res = await app.request('/api/big')
  expect(res.status).toBe(413)
  expect(await res.json()).toEqual({ error: 'payload_too_large', message: 'too big' })
})

test('unknown path returns JSON 404', async () => {
  const app = createApp(await testDeps())
  const res = await app.request('/api/nope')
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'not_found', message: 'Not found' })
})
