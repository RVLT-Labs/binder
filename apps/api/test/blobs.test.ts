import { describe, expect, test } from 'vitest'
import { createShow, createToken, listOrganisations } from '../src/services'
import { librettoBytes, postDocument, setupShow } from './documentHelpers'

async function uploaded() {
  const ctx = await setupShow()
  const res = await postDocument(ctx.app, ctx.editor.cookie, ctx.show.id, {
    kind: 'libretto',
    title: 'Libretto',
  })
  const { version } = await res.json()
  return { ...ctx, version, url: `/blobs/${version.originalKey}` }
}

describe('GET /blobs/*', () => {
  test('streams the PDF to a member with the right headers', async () => {
    const { app, viewer, version, url } = await uploaded()
    const res = await app.request(url, { headers: { cookie: viewer.cookie } })
    expect(res.status).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes).toEqual(librettoBytes())
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="original.pdf"')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(version.originalKey.endsWith('/original.pdf')).toBe(true)
  })

  test('requires authentication; a non-member cannot tell the blob exists', async () => {
    const { app, outsider, url } = await uploaded()
    expect((await app.request(url)).status).toBe(401)
    const res = await app.request(url, { headers: { cookie: outsider.cookie } })
    expect(res.status).toBe(404)
  })

  test('rejects bad keys with 400, including traversal', async () => {
    const { app, editor, show } = await uploaded()
    const headers = { cookie: editor.cookie }
    for (const path of [
      `/blobs/shows/${show.id}/..%2f..%2f..%2fetc%2fpasswd`,
      `/blobs/shows/${show.id}/documents/%2e%2e%2fx`,
      '/blobs/etc/passwd',
      `/blobs/shows/${show.id}/a%00b`,
      `/blobs/shows/${show.id}/%E0%A4%A`,
      '/blobs/',
    ]) {
      const res = await app.request(path, { headers })
      expect([path, res.status]).toEqual([path, 400])
    }
  })

  test('a valid key whose blob is missing is 404', async () => {
    const { app, editor, show } = await uploaded()
    const res = await app.request(`/blobs/shows/${show.id}/documents/d/versions/v/original.pdf`, {
      headers: { cookie: editor.cookie },
    })
    expect(res.status).toBe(404)
  })

  test('a token scoped to another show is 403, one scoped to this show is 200', async () => {
    const { app, deps, ownerActor, show, url } = await uploaded()
    const [org] = await listOrganisations(deps.db, ownerActor)
    const other = await createShow(deps.db, ownerActor, { organisationId: org.id, title: 'Other' })
    const outOfScope = await createToken(deps.db, ownerActor, {
      name: 'other',
      showScope: [other.id],
    })
    const inScope = await createToken(deps.db, ownerActor, { name: 'this', showScope: [show.id] })

    const denied = await app.request(url, {
      headers: { authorization: `Bearer ${outOfScope.token}` },
    })
    expect(denied.status).toBe(403)
    const ok = await app.request(url, { headers: { authorization: `Bearer ${inScope.token}` } })
    expect(ok.status).toBe(200)
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(librettoBytes())
  })
})
