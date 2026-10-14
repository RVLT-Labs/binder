import { type Db, documents, documentVersions, pages } from '@binder/db'
import { type Actor, type Anchor, newId } from '@binder/shared'
import { addShowMember, type Department, listDepartments } from '../src/services'
import { setupShow } from './documentHelpers'
import { createTestUser } from './helpers'

export const READY_PAGES = 20

/** A libretto document whose current version is `ready` with `READY_PAGES` pages. No processing runs. */
export async function addReadyDocument(
  db: Db,
  showId: string,
  userId: string,
): Promise<{ docId: string; versionId: string }> {
  const docId = newId()
  const versionId = newId()
  await db.insert(documents).values({
    id: docId,
    showId,
    kind: 'libretto',
    title: 'Libretto',
    currentVersionId: versionId,
    updatedBy: userId,
  })
  await db.insert(documentVersions).values({
    id: versionId,
    showId,
    documentId: docId,
    versionNumber: 1,
    originalKey: `test/${versionId}.pdf`,
    pageCount: READY_PAGES,
    uploadedBy: userId,
    status: 'ready',
  })
  await db.insert(pages).values(
    Array.from({ length: READY_PAGES }, (_, index) => ({
      id: newId(),
      showId,
      documentVersionId: versionId,
      index,
      width: 612,
      height: 792,
      rotation: 0,
      status: 'ready' as const,
    })),
  )
  return { docId, versionId }
}

/** `setupShow` plus a ready libretto, the default departments by code, and an editor scoped to LX. */
export async function setupMarkupShow() {
  const s = await setupShow()
  const db = s.deps.db
  const list = await listDepartments(db, s.ownerActor, { showId: s.show.id })
  const depts = Object.fromEntries(list.map((d) => [d.code, d])) as Record<string, Department>
  const { docId, versionId } = await addReadyDocument(db, s.show.id, s.owner.id)
  const lxEmail = `lx-${newId()}@doc.test`
  const lx = await createTestUser(s.app, s.deps, {
    email: lxEmail,
    name: 'Lex',
    password: 'password123',
  })
  await addShowMember(db, s.ownerActor, {
    showId: s.show.id,
    email: lxEmail,
    role: 'editor',
    departments: [depts.LX.id],
  })
  const actorOf = (userId: string): Actor => ({ userId, via: 'web', agent: null })
  return {
    ...s,
    depts,
    docId,
    versionId,
    editorLx: lx,
    actors: {
      owner: s.ownerActor,
      editor: actorOf(s.editor.id),
      editorLx: actorOf(lx.id),
      viewer: actorOf(s.viewer.id),
    },
  }
}

/** An `ok` anchor on a version, in displayed page points. */
export function anchorAt(
  docId: string,
  versionId: string,
  pageIndex: number,
  x = 100,
  y = 700,
): Anchor {
  return { documentId: docId, documentVersionId: versionId, pageIndex, x, y, status: 'ok' }
}
