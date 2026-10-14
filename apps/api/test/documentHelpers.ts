import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { FIXTURES } from '@binder/fixtures'
import type { Actor } from '@binder/shared'
import type { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../src/app'
import { addShowMember, createShow, listOrganisations } from '../src/services'
import { createTestApp, createTestUser, RecordingJobs } from './helpers'

// biome-ignore lint/suspicious/noExplicitAny: test helper over arbitrary response bodies
export type Json = any
export type JsonResponse = Omit<Response, 'json'> & { json(): Promise<Json> }
export const asJson = (res: Response): JsonResponse => res as JsonResponse

let n = 0
const actor = (userId: string): Actor => ({ userId, via: 'web', agent: null })

export const librettoBytes = () => readFileSync(FIXTURES.librettoPdf)

/** An app with a show, an owner, an editor, a viewer, and an outsider with no membership. */
export async function setupShow() {
  const jobs = new RecordingJobs()
  const { app, deps } = await createTestApp({ jobs })
  const i = ++n
  const mk = (k: string, name: string) =>
    createTestUser(app, deps, { email: `${k}${i}@doc.test`, name, password: 'password123' })
  const owner = await mk('o', 'Olive')
  const editor = await mk('e', 'Ed')
  const viewer = await mk('v', 'Vi')
  const outsider = await mk('x', 'Xan')
  const [org] = await listOrganisations(deps.db, actor(owner.id))
  const show = await createShow(deps.db, actor(owner.id), { organisationId: org.id, title: 'Show' })
  await addShowMember(deps.db, actor(owner.id), {
    showId: show.id,
    email: `e${i}@doc.test`,
    role: 'editor',
  })
  await addShowMember(deps.db, actor(owner.id), {
    showId: show.id,
    email: `v${i}@doc.test`,
    role: 'viewer',
  })
  return { app, deps, jobs, owner, editor, viewer, outsider, show, ownerActor: actor(owner.id) }
}

export function multipart(
  fields: Record<string, string>,
  file: { bytes: Uint8Array; filename?: string } | null,
): FormData {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) {
    form.append(
      'file',
      new Blob([file.bytes], { type: 'application/pdf' }),
      file.filename ?? 'upload.pdf',
    )
  }
  return form
}

export async function postDocument(
  app: Hono<AppEnv>,
  cookie: string,
  showId: string,
  fields: Record<string, string>,
  file: { bytes: Uint8Array; filename?: string } | null = { bytes: librettoBytes() },
  headers: Record<string, string> = {},
) {
  return asJson(
    await app.request(`/api/shows/${showId}/documents`, {
      method: 'POST',
      headers: { cookie, ...headers },
      body: multipart(fields, file),
    }),
  )
}

export async function postVersion(
  app: Hono<AppEnv>,
  cookie: string,
  showId: string,
  docId: string,
  fields: Record<string, string>,
  file: { bytes: Uint8Array } | null = { bytes: librettoBytes() },
) {
  return asJson(
    await app.request(`/api/shows/${showId}/documents/${docId}/versions`, {
      method: 'POST',
      headers: { cookie },
      body: multipart(fields, file),
    }),
  )
}

/** Every file (including temp files) currently under the blob root. */
export async function blobFiles(deps: AppDeps): Promise<string[]> {
  const entries = await readdir(deps.config.BLOB_ROOT, { recursive: true, withFileTypes: true })
  return entries.filter((e) => e.isFile()).map((e) => `${e.parentPath}/${e.name}`)
}
