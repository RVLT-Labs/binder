import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { FIXTURES } from '@binder/fixtures'
import type { Anchor, WordLayer } from '@binder/shared'
import { API_URL, APP_URL, readRun, type UserKey } from './env'

/** Server-side setup for the revision specs: their own show, document, and cues, through the API. */

export interface RevisionShow {
  showId: string
  title: string
  lxId: string
  sndId: string
  documentId: string
  /** The first version. */
  versionId: string
}

export async function call<T>(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`sign-in: ${res.status} ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

export async function signInAsOwner(): Promise<string> {
  const { users, password } = readRun()
  return signIn(users.owner.email, password)
}

export async function upload(
  cookie: string,
  path: string,
  file: string,
  fields: Record<string, string>,
) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append('file', new Blob([readFileSync(file)], { type: 'application/pdf' }), basename(file))
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { cookie, origin: APP_URL },
    body: form,
  })
  if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`)
  return (await res.json()) as { document?: { id: string }; version: { id: string } }
}

interface ListedDocument {
  id: string
  currentVersionId: string | null
  versions: { id: string; status: string }[]
}

async function listed(cookie: string, showId: string, documentId: string) {
  const { documents } = await call<{ documents: ListedDocument[] }>(
    cookie,
    'GET',
    `/api/shows/${showId}/documents`,
  )
  const doc = documents.find((d) => d.id === documentId)
  if (!doc) throw new Error('document missing')
  return doc
}

/** The document's current version id. */
export async function currentVersion(cookie: string, show: RevisionShow): Promise<string> {
  const doc = await listed(cookie, show.showId, show.documentId)
  if (!doc.currentVersionId) throw new Error('no current version')
  return doc.currentVersionId
}

/** Waits for a version to be `ready` (and, when `current`, to become the document's current one). */
export async function waitForVersion(
  cookie: string,
  showId: string,
  documentId: string,
  versionId: string,
  opts: { current: boolean; timeoutMs?: number },
): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 150_000)
  for (;;) {
    const doc = await listed(cookie, showId, documentId)
    const status = doc.versions.find((v) => v.id === versionId)?.status
    if (status === 'failed') throw new Error(`version ${versionId} failed`)
    if (status === 'ready' && (!opts.current || doc.currentVersionId === versionId)) return
    if (Date.now() > deadline) throw new Error(`version ${versionId} is ${status}`)
    await new Promise((r) => setTimeout(r, 1_000))
  }
}

/**
 * A fresh show owned by the run's owner, with the LX editor and the viewer as members and the short
 * libretto uploaded and ready. The spec archives it when it is done.
 */
export async function createRevisionShow(
  titlePrefix: string,
  /** The whole title, when a spec needs a particular one (the default is the prefix and a timestamp). */
  fullTitle?: string,
): Promise<RevisionShow> {
  const { users } = readRun()
  const owner = await signInAsOwner()
  const title = fullTitle ?? `${titlePrefix} ${Date.now()}`
  const { organisations } = await call<{ organisations: { id: string }[] }>(
    owner,
    'GET',
    '/api/me/orgs',
  )
  const { show } = await call<{ show: { id: string } }>(
    owner,
    'POST',
    `/api/orgs/${organisations[0]?.id}/shows`,
    { title },
  )
  const { departments } = await call<{ departments: { id: string; code: string }[] }>(
    owner,
    'GET',
    `/api/shows/${show.id}/departments`,
  )
  const lxId = departments.find((d) => d.code === 'LX')?.id ?? ''
  const sndId = departments.find((d) => d.code === 'SND')?.id ?? ''
  const addMember = async (email: string, role: 'editor' | 'viewer', scope?: string[]) => {
    const { membership } = await call<{ membership: { id: string } }>(
      owner,
      'POST',
      `/api/shows/${show.id}/members`,
      { email, role },
    )
    if (scope) {
      await call(owner, 'PATCH', `/api/memberships/${membership.id}`, { departments: scope })
    }
  }
  await addMember(users.lxEditor.email, 'editor', [lxId])
  await addMember(users.viewer.email, 'viewer')

  const created = await upload(
    owner,
    `/api/shows/${show.id}/documents`,
    FIXTURES.librettoShortPdf,
    {
      kind: 'libretto',
      title: 'Revision libretto',
    },
  )
  const documentId = created.document?.id ?? ''
  await waitForVersion(owner, show.id, documentId, created.version.id, { current: false })
  return { showId: show.id, title, lxId, sndId, documentId, versionId: created.version.id }
}

/** Uploads the short revision as the document's next version, as the web app's API does. */
export async function uploadRevision(
  cookie: string,
  show: RevisionShow,
  label: string,
): Promise<string> {
  const { version } = await upload(
    cookie,
    `/api/shows/${show.showId}/documents/${show.documentId}/versions`,
    FIXTURES.revisedShortCutPdf,
    { label },
  )
  return version.id
}

/**
 * A fresh show owned by the run's owner with the given users as editors, for a spec that changes
 * the show itself (and so must not touch the shared one). The spec archives it when it is done.
 */
export async function createOwnedShow(
  titlePrefix: string,
  editors: UserKey[],
): Promise<{ showId: string; title: string }> {
  const { users } = readRun()
  const owner = await signInAsOwner()
  const title = `${titlePrefix} ${Date.now()}`
  const { organisations } = await call<{ organisations: { id: string }[] }>(
    owner,
    'GET',
    '/api/me/orgs',
  )
  const { show } = await call<{ show: { id: string } }>(
    owner,
    'POST',
    `/api/orgs/${organisations[0]?.id}/shows`,
    { title },
  )
  for (const key of editors) {
    await call(owner, 'POST', `/api/shows/${show.id}/members`, {
      email: users[key].email,
      role: 'editor',
    })
  }
  return { showId: show.id, title }
}

/** Archives the show so the owner's list of active shows is what other specs expect. */
export async function archiveShow(show: { showId: string } | undefined): Promise<void> {
  if (!show) return
  await call(await signInAsOwner(), 'PATCH', `/api/shows/${show.showId}`, { status: 'archived' })
}

async function wordLayer(cookie: string, show: RevisionShow, versionId: string, index: number) {
  const key = `shows/${show.showId}/documents/${show.documentId}/versions/${versionId}/pages/${index}/words.json`
  const res = await fetch(`${API_URL}/blobs/${key}`, { headers: { cookie } })
  if (!res.ok) throw new Error(`words ${index}: ${res.status}`)
  return (await res.json()) as WordLayer
}

/**
 * The anchor of the line of version `versionId` whose text contains `snippet`, as a cue placed
 * there with snapping would have it: at the line's first word, y on the line, quote bound.
 */
export async function anchorOnLine(
  cookie: string,
  show: RevisionShow,
  versionId: string,
  snippet: string,
): Promise<Anchor> {
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const layer = await wordLayer(cookie, show, versionId, pageIndex)
    for (const line of layer.lines) {
      const words = line.map((i) => layer.words[i])
      if (
        !words
          .map((w) => w.t)
          .join(' ')
          .includes(snippet)
      )
        continue
      const first = line[0] ?? 0
      const last = Math.min(line.length, 8) - 1
      return {
        documentId: show.documentId,
        documentVersionId: versionId,
        pageIndex,
        x: (words[0]?.x ?? 0) + 2,
        y: words.reduce((sum, w) => sum + w.y + w.h / 2, 0) / words.length,
        text: {
          quote: words
            .slice(0, 8)
            .map((w) => w.t)
            .join(' '),
          wordStart: first,
          wordEnd: line[last] ?? first,
        },
        status: 'ok',
      }
    }
  }
  throw new Error(`no line contains "${snippet}"`)
}

let batch = 0

/** Writes rows the way a client's sync upload does (the API applies them as that user). */
export async function syncUpload(
  cookie: string,
  entries: Array<{ table: string; id: string; op: 'PUT'; data: Record<string, unknown> }>,
): Promise<void> {
  const res = await call<{ applied: number; rejected: unknown[] }>(
    cookie,
    'POST',
    '/api/sync/upload',
    {
      batchId: `e2e-${Date.now()}-${batch++}`,
      entries: entries.map((e) => ({ ...e, clientTs: new Date().toISOString() })),
    },
  )
  if (res.rejected.length > 0) throw new Error(`rejected: ${JSON.stringify(res.rejected)}`)
}

export interface SeedCue {
  id: string
  departmentId: string
  major: number
  label: string
  anchor: Anchor
}

export const cueEntry = (show: RevisionShow, c: SeedCue) => ({
  table: 'cues',
  id: c.id,
  op: 'PUT' as const,
  data: {
    show_id: show.showId,
    department_id: c.departmentId,
    major: c.major,
    minor: 0,
    label: c.label,
    anchor: JSON.stringify(c.anchor),
    type: 'go',
    notes: '',
    colour: null,
  },
})

export const noteEntry = (
  show: RevisionShow,
  n: { id: string; userId: string; text: string; anchor: Anchor },
) => ({
  table: 'annotations',
  id: n.id,
  op: 'PUT' as const,
  data: {
    show_id: show.showId,
    layer_kind: 'personal',
    layer_id: n.userId,
    anchor: JSON.stringify(n.anchor),
    type: 'note',
    geometry: '{}',
    text: n.text,
    style: '{}',
  },
})

export const newRowId = () => randomUUID()
