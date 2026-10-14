import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { documents, documentVersions, pages } from '@binder/db'
import { newId } from '@binder/shared'
import { and, eq, gte, sql } from 'drizzle-orm'
import { searchableBlobKey } from '../blob/keys'
import { firstLine, ToolError } from './exec'
import { describeOcrFailure, runOcrmypdf } from './ocrmypdf'
import { finishVersionIfDone, SYSTEM } from './pageJob'
import { listImagePages, type PdfInfo, pdfInfo } from './poppler'
import { blobFile, withTempDir } from './tmp'
import type { ProcessingDeps } from './types'

/**
 * Reads the searchable PDF's pages. Poppler exits 1 when it cannot open the file at all (a user
 * password, or a broken PDF that OCRmyPDF also refused); retrying cannot help, so that becomes zero
 * pages and a recorded error rather than a failed job.
 */
async function readPages(pdf: string, errors: string[]): Promise<PdfInfo> {
  try {
    return await pdfInfo(pdf)
  } catch (err) {
    if (!(err instanceof ToolError) || err.exitCode !== 1) throw err
    errors.push(`cannot read pages: ${firstLine(err.stderr)}`)
    return { pageCount: 0, pages: [] }
  }
}

/**
 * Document job (spec 5.1): writes the searchable PDF, creates one queued page row per page with
 * displayed dimensions, and queues a page job for each. Idempotent: a retry upserts the same page
 * rows back to queued, so page ids are stable and duplicate page jobs are harmless (R16).
 */
export async function processDocumentVersion(
  deps: ProcessingDeps,
  versionId: string,
): Promise<void> {
  const { db, blobs, jobs } = deps
  const [row] = await db
    .select({ version: documentVersions, ocrMode: documents.ocrMode })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documentVersions.id, versionId))
  if (!row || row.version.status === 'ready') return
  const { version, ocrMode } = row

  await db
    .update(documentVersions)
    .set({ status: 'processing', error: null, updatedBy: SYSTEM })
    .where(eq(documentVersions.id, versionId))

  const pageIds = await withTempDir('binder-doc-', async (dir) => {
    const original = await blobFile(blobs, version.originalKey, dir, 'original.pdf')
    const searchable = join(dir, 'searchable.pdf')
    const errors: string[] = []

    // A document with no images at all has nothing to OCR (spec 5.1). If pdfimages cannot read
    // it, let OCRmyPDF decide and report.
    const imagePages = ocrMode === 'auto' ? await listImagePages(original).catch(() => null) : null
    const mode = ocrMode === 'never' || imagePages?.size === 0 ? 'never' : 'auto'
    const ocr = await runOcrmypdf(original, searchable, { mode })
    if (mode === 'auto' && !ocr.ocrApplied) {
      errors.push(describeOcrFailure(ocr))
      console.warn(`OCR fell back to a copy for version ${versionId}:\n${ocr.stderr}`)
    }

    const key = searchableBlobKey(version.showId, version.documentId, version.id)
    await blobs.put(key, createReadStream(searchable), 'application/pdf')
    const info = await readPages(searchable, errors)

    return db.transaction(async (tx) => {
      await tx
        .update(documentVersions)
        .set({ searchableKey: key, error: errors.join('; ') || null, updatedBy: SYSTEM })
        .where(eq(documentVersions.id, versionId))
      await tx
        .delete(pages)
        .where(and(eq(pages.documentVersionId, versionId), gte(pages.index, info.pageCount)))
      if (info.pages.length === 0) return []
      const rows = await tx
        .insert(pages)
        .values(
          info.pages.map((p, index) => ({
            id: newId(),
            showId: version.showId,
            documentVersionId: versionId,
            index,
            width: p.width,
            height: p.height,
            rotation: p.rotation,
            ocrApplied: ocr.ocrApplied && (imagePages === null || imagePages.has(index)),
            status: 'queued' as const,
            updatedBy: SYSTEM,
          })),
        )
        .onConflictDoUpdate({
          target: [pages.documentVersionId, pages.index],
          set: {
            width: sql`excluded.width`,
            height: sql`excluded.height`,
            rotation: sql`excluded.rotation`,
            ocrApplied: sql`excluded.ocr_applied`,
            status: 'queued',
            error: null,
            thumbKey: null,
            wordsKey: null,
            updatedAt: sql`now()`,
            updatedBy: SYSTEM,
          },
        })
        .returning({ id: pages.id, index: pages.index })
      return rows.sort((a, b) => a.index - b.index).map((r) => r.id)
    })
  })

  if (pageIds.length > 0) await jobs.enqueuePageProcess(pageIds)
  // Covers a version with no readable pages; otherwise the last page job does this.
  await finishVersionIfDone(db, versionId)
}

/** Called when the document job has failed after its last retry. */
export async function markVersionFailed(
  db: ProcessingDeps['db'],
  versionId: string,
  error: string,
): Promise<void> {
  await db
    .update(documentVersions)
    .set({ status: 'failed', error, updatedBy: SYSTEM })
    .where(eq(documentVersions.id, versionId))
}
