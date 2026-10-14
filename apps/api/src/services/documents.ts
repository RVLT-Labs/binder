import { documents, shows } from '@binder/db'
import { type Actor, type DocumentKind, newId, type OcrMode } from '@binder/shared'
import { eq, type InferSelectModel } from 'drizzle-orm'
import { notFound } from '../errors'
import { logChange } from './changeLog'
import type { Executor } from './executor'
import { assertShowWritable, requireShowRole } from './tenancy'

export type Document = InferSelectModel<typeof documents>

export interface DocumentPatch {
  title?: string
  kind?: DocumentKind
  ocrMode?: OcrMode
  snapToText?: boolean | null
  sortOrder?: number
}

const PATCHABLE = ['title', 'kind', 'ocrMode', 'snapToText', 'sortOrder'] as const

/** Editor or above on the document's show; archived shows are read-only. Logs only changed columns. */
export async function updateDocument(
  db: Executor,
  actor: Actor,
  input: { documentId: string; patch: DocumentPatch; batchId?: string; clientTs?: Date },
): Promise<Document> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(documents).where(eq(documents.id, input.documentId))
    if (!current) throw notFound('Document not found')
    await requireShowRole(tx, actor, current.showId, 'editor')
    const [show] = await tx
      .select({ status: shows.status })
      .from(shows)
      .where(eq(shows.id, current.showId))
    if (!show) throw notFound('Show not found')
    assertShowWritable(show)

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of PATCHABLE) {
      const next = input.patch[key]
      if (next === undefined || next === current[key]) continue
      before[key] = current[key]
      after[key] = next
    }
    if (Object.keys(after).length === 0) return current

    const [updated] = await tx
      .update(documents)
      .set({ ...after, updatedBy: actor.userId })
      .where(eq(documents.id, input.documentId))
      .returning()
    await logChange(tx, {
      showId: current.showId,
      actor,
      batchId,
      table: 'documents',
      rowId: input.documentId,
      op: 'update',
      before,
      after,
      clientTs: input.clientTs,
    })
    return updated
  })
}
