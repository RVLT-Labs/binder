import { describe, expect, test } from 'vitest'
import { createToken, listOrganisations } from '../src/services'
import { multipart, setupShow } from './documentHelpers'
import { APP_ORIGIN } from './helpers'

// Minor 13: JSON bodies are capped at 2 MB everywhere (including the unauthenticated /api/auth/*
// and /mcp); only the PDF upload routes take large bodies.
const MB = 1024 * 1024
const bigJson = () => JSON.stringify({ name: 'x'.repeat(3 * MB) })

async function errorOf(res: Response) {
  return ((await res.json()) as { error: string }).error
}

describe('2 MB JSON body limit', () => {
  test('a 3 MB JSON POST is 413 on the API, auth and MCP routes', async () => {
    const { app, deps, owner } = await setupShow()
    const actor = { userId: owner.id, via: 'web' as const, agent: null }
    const [org] = await listOrganisations(deps.db, actor)
    const { token } = await createToken(deps.db, actor, { name: 'mcp', showScope: '*' })
    const json = { 'content-type': 'application/json' }
    const cases: Array<[string, Record<string, string>]> = [
      ['/api/orgs', { ...json, cookie: owner.cookie, origin: APP_ORIGIN }],
      [`/api/orgs/${org.id}/shows`, { ...json, cookie: owner.cookie, origin: APP_ORIGIN }],
      ['/api/sync/upload', { ...json, cookie: owner.cookie, origin: APP_ORIGIN }],
      ['/api/auth/sign-in/email', { ...json, origin: APP_ORIGIN }],
      ['/api/auth/sign-in/magic-link', { ...json, origin: APP_ORIGIN }],
      [
        '/mcp',
        {
          ...json,
          accept: 'application/json, text/event-stream',
          host: 'localhost',
          authorization: `Bearer ${token}`,
        },
      ],
    ]
    for (const [path, headers] of cases) {
      const res = await app.request(path, { method: 'POST', headers, body: bigJson() })
      expect(res.status, path).toBe(413)
      expect(await errorOf(res), path).toBe('payload_too_large')
    }
  })

  test('the limit holds without a Content-Length (chunked body)', async () => {
    const { app } = await setupShow()
    const bytes = new TextEncoder().encode(bigJson())
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 64 * 1024)
          controller.enqueue(bytes.slice(i, i + 64 * 1024))
        controller.close()
      },
    })
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
      body,
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(413)
  })

  test('a small JSON body is unaffected', async () => {
    const { app, owner } = await setupShow()
    const res = await app.request('/api/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: APP_ORIGIN },
      body: JSON.stringify({ name: 'Small' }),
    })
    expect(res.status).toBe(201)
  })

  test('PDF uploads over 2 MB are still accepted', async () => {
    const { app, editor, show } = await setupShow()
    const bytes = new Uint8Array(3 * MB).fill(0x20)
    bytes.set(new TextEncoder().encode('%PDF-1.7\n'))
    const res = await app.request(`/api/shows/${show.id}/documents`, {
      method: 'POST',
      headers: { cookie: editor.cookie, origin: APP_ORIGIN },
      body: multipart({ kind: 'other', title: 'Big', ocrMode: 'never' }, { bytes }),
    })
    expect(res.status).toBe(201)
  })
})
