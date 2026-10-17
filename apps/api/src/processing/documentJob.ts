import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { documents, documentVersions, pages } from '@binder/db'
import { type FailureCode, newId, type OcrMode } from '@binder/shared'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { searchableBlobKey } from '../blob/keys'
import { defaultSnapToText } from '../services/documents'
import { ProcessingCancelled, watchForCancel } from './cancel'
import { firstLine, ToolError } from './exec'
import { describeOcrFailure, runOcrmypdf } from './ocrmypdf'
import { SYSTEM } from './pageJob'
import { countTextChars, imageStats, type PdfInfo, PdfInfoParseError, pdfInfo } from './poppler'
import { blobFile, withTempDir } from './tmp'
import type { ProcessingDeps } from './types'

const PASSWORD_MESSAGE = 'This PDF is password-protected. Remove the password and upload it again.'
const UNREADABLE_MESSAGE = 'This file could not be read as a PDF.'

/** A text-anchored document with fewer text characters than this, in total, has no usable text. */
export const MIN_TEXT_CHARS = 20
/** A scan below this median resolution is blamed for having no text (`low_resolution`). */
export const LOW_RESOLUTION_PPI = 150

/**
 * Reads the searchable PDF's pages, or says why it has none. Poppler exiting non-zero, or output
 * without a page count or page sizes, means the file cannot be read (a user password, or not a PDF
 * at all), which no retry can fix (R44, R47); a timeout or a failure to start rethrows so the job is
 * retried.
 */
async function readPages(
  pdf: string,
): Promise<PdfInfo | { unreadable: string; password: boolean }> {
  try {
    const info = await pdfInfo(pdf)
    if (info.pageCount > 0) return info
    return { unreadable: 'pdfinfo: the PDF has no pages', password: false }
  } catch (err) {
    if (err instanceof PdfInfoParseError) return { unreadable: err.message, password: false }
    if (!(err instanceof ToolError) || err.exitCode === null) throw err
    return {
      unreadable: `pdfinfo exit ${err.exitCode}: ${firstLine(err.stderr)}`,
      password: /password/i.test(err.stderr),
    }
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
  try {
    await runDocumentJob(deps, versionId)
  } catch (err) {
    // The version was cancelled while OCR ran. Nothing was written, so the job just ends, and
    // pg-boss completes it instead of retrying.
    if (!(err instanceof ProcessingCancelled)) throw err
  }
}

async function runDocumentJob(deps: ProcessingDeps, versionId: string): Promise<void> {
  const { db, blobs, jobs } = deps
  const [row] = await db
    .select({
      version: documentVersions,
      ocrMode: documents.ocrMode,
      kind: documents.kind,
      snapToText: documents.snapToText,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documentVersions.id, versionId))
  if (!row || row.version.status === 'ready') return
  const { version, ocrMode } = row
  const textAnchored = row.snapToText ?? defaultSnapToText(row.kind)

  // Only a version still waiting for this job may start. A cancelled (failed) or finished version
  // is left alone, so a job that was queued before the cancel cannot bring it back; `processing`
  // stays allowed so a pg-boss retry of the same job continues.
  const started = await db
    .update(documentVersions)
    .set({ status: 'processing', error: null, updatedBy: SYSTEM })
    .where(
      and(
        eq(documentVersions.id, versionId),
        inArray(documentVersions.status, ['queued', 'processing']),
      ),
    )
    .returning({ id: documentVersions.id })
  if (started.length === 0) return

  const pageIds = await withTempDir('binder-doc-', async (dir) => {
    const original = await blobFile(blobs, version.originalKey, dir, 'original.pdf')
    const searchable = join(dir, 'searchable.pdf')
    const errors: string[] = []

    // A document with no images at all has nothing to OCR (spec 5.1). If pdfimages cannot read
    // it, let OCRmyPDF decide and report.
    const images = ocrMode === 'auto' ? await imageStats(original).catch(() => null) : null
    const imagePages = images?.pages ?? null
    const mode = ocrMode === 'never' || imagePages?.size === 0 ? 'never' : 'auto'
    const ocr = await runOcr(db, versionId, original, searchable, mode)
    if (mode === 'auto' && !ocr.ocrApplied) {
      errors.push(describeOcrFailure(ocr))
      console.warn(`OCR fell back to a copy for version ${versionId}:\n${ocr.stderr}`)
    }
    if (ocr.note) {
      errors.push(ocr.note)
      console.warn(`OCR for version ${versionId}: ${ocr.note}`)
    }

    const info = await readPages(searchable)
    if ('unreadable' in info) {
      const human = info.password ? PASSWORD_MESSAGE : UNREADABLE_MESSAGE
      await markVersionFailed(
        db,
        versionId,
        `${human} (${[...errors, info.unreadable].join('; ')})`,
        info.password ? 'password_protected' : 'unreadable',
      )
      return []
    }

    // A script has to be searchable and anchorable by its text. Scores and blocking anchor by
    // position, and an OCR-off document was asked not to be read, so they are exempt (decision 3).
    if (textAnchored && ocrMode === 'auto') {
      const chars = await countTextChars(searchable)
      if (mode === 'auto' && !ocr.ocrApplied && chars < MIN_TEXT_CHARS) {
        // OCR was meant to run and did not (it failed or timed out), so the missing text says
        // nothing about the file. A retry may well succeed, so this is a retryable failure (R29).
        await markVersionFailed(
          db,
          versionId,
          `OCR did not run, so no text could be read (${errors.join('; ')})`,
          ocr.timedOut ? 'timeout' : 'unknown',
        )
        return []
      }
      if (chars < MIN_TEXT_CHARS) {
        const ppi = images?.medianPpi ?? null
        const lowResolution = ppi !== null && ppi < LOW_RESOLUTION_PPI
        const found = `found ${chars} text characters in ${info.pageCount} pages${lowResolution ? `; median scan resolution ${Math.round(ppi)} dpi` : ''}`
        await markVersionFailed(
          db,
          versionId,
          `No text could be read from the document (${[...errors, found].join('; ')})`,
          lowResolution ? 'low_resolution' : 'no_text',
          lowResolution ? Math.round(ppi) : null,
        )
        return []
      }
    }
    const key = searchableBlobKey(version.showId, version.documentId, version.id)
    await blobs.put(key, createReadStream(searchable), 'application/pdf')

    return db.transaction(async (tx) => {
      // A cancel (or a retry's newer run) may have won while this job was working. Hold the row so
      // it cannot change underneath us, and throw our work away unless the version is still ours.
      const [current] = await tx
        .select({ status: documentVersions.status })
        .from(documentVersions)
        .where(eq(documentVersions.id, versionId))
        .for('update')
      if (current?.status !== 'processing') {
        // Only delete the blob when no one can be using it: a failed or removed version. A version
        // that is queued again or ready owns this same key now.
        if (!current || current.status === 'failed') await blobs.delete(key).catch(() => {})
        return []
      }
      await tx
        .update(documentVersions)
        .set({ searchableKey: key, error: errors.join('; ') || null, updatedBy: SYSTEM })
        .where(eq(documentVersions.id, versionId))
      await tx
        .delete(pages)
        .where(and(eq(pages.documentVersionId, versionId), gte(pages.index, info.pageCount)))
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

  // The last page job marks the version ready.
  if (pageIds.length > 0) await jobs.enqueuePageProcess(pageIds)
}

/**
 * Runs OCR while watching for a cancel. When the version stops being `processing` the watcher
 * aborts OCRmyPDF (its whole process group) and this throws ProcessingCancelled, which ends the
 * job without writing anything.
 */
async function runOcr(
  db: ProcessingDeps['db'],
  versionId: string,
  input: string,
  output: string,
  mode: OcrMode,
) {
  const controller = new AbortController()
  const stopWatching = watchForCancel(db, versionId, controller)
  try {
    return await runOcrmypdf(input, output, { mode, signal: controller.signal })
  } catch (err) {
    if (err instanceof ToolError && err.aborted) throw new ProcessingCancelled(versionId)
    throw err
  } finally {
    stopWatching()
  }
}

/**
 * Fails a version that has not reached ready; a ready version is never failed afterwards. Also the
 * document job's dead-letter action (R45), when pg-boss gave up after retries or expiry.
 */
export async function markVersionFailed(
  db: ProcessingDeps['db'],
  versionId: string,
  error: string,
  code: FailureCode,
  dpi: number | null = null,
): Promise<void> {
  await db
    .update(documentVersions)
    .set({ status: 'failed', error, failureCode: code, failureDpi: dpi, updatedBy: SYSTEM })
    .where(
      and(
        eq(documentVersions.id, versionId),
        inArray(documentVersions.status, ['queued', 'processing']),
      ),
    )
}
