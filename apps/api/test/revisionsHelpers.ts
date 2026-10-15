import { createReadStream } from 'node:fs'
import { buildWordStream, findQuote, lineCentreY, snapToLine } from '@binder/core'
import { documentVersions } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import type { Anchor } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { reanchorVersion } from '../src/processing/reanchorJob'
import {
  addDocumentVersion,
  createAnnotation,
  createCue,
  createDocument,
  updateAnnotation,
} from '../src/services'
import { loadVersionText } from '../src/services/wordLayers'
import { RecordingJobs } from './helpers'
import { setupMarkupShow } from './markupHelpers'
import { processVersion } from './processingHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>

/** A snapped anchor on a line of the page whose quote is unique in `versionId` and passes `accept`. */
async function lineAnchor(
  s: Setup,
  docId: string,
  versionId: string,
  pageIndex: number,
  accept: (quote: string) => boolean = () => true,
): Promise<Anchor> {
  const text = await loadVersionText(s.deps.db, s.deps.blobs, versionId)
  const layer = text.layers.get(pageIndex)
  if (!layer) throw new Error(`page ${pageIndex} has no words`)
  const stream = buildWordStream(text.layers)
  for (let lineIndex = 0; lineIndex < layer.lines.length; lineIndex++) {
    const line = (layer.lines[lineIndex] ?? []).filter((i) => layer.words[i])
    if (line.length < 5) continue
    const first = layer.words[line[0] as number]
    if (!first) continue
    const snapped = snapToLine(layer, { x: first.x, y: lineCentreY(layer, lineIndex) })
    if (!snapped) continue
    const quote = snapped.text.quote
    if (findQuote(stream, quote, 'exact').length !== 1 || !accept(quote)) continue
    return {
      documentId: docId,
      documentVersionId: versionId,
      pageIndex,
      x: first.x,
      y: snapped.y,
      text: snapped.text,
      status: 'ok',
    }
  }
  throw new Error(`no usable line on page ${pageIndex}`)
}

/**
 * The shared fixture of the revisions tests: the real libretto processed as v1, the cut revision as
 * v2 (uploaded by the unscoped editor, so the re-anchoring run is attributed to them), a spread of
 * cues and annotations placed on v1, and then the re-anchoring run, so v2 is current and the rows
 * that could not be placed sit `unresolved` on it.
 */
export async function buildRevisedFixture() {
  const s = await setupMarkupShow()
  const db = s.deps.db
  const deps = (jobs = new RecordingJobs()) => ({ db, blobs: s.deps.blobs, jobs })
  const { document, version: v1 } = await createDocument(db, s.deps.blobs, s.jobs, s.ownerActor, {
    showId: s.show.id,
    kind: 'libretto',
    title: 'Pirates',
    file: createReadStream(FIXTURES.librettoPdf),
  })
  await processVersion(deps(), v1.id)
  const v2 = await addDocumentVersion(db, s.deps.blobs, s.jobs, s.ownerActor, {
    documentId: document.id,
    label: 'cut',
    file: createReadStream(FIXTURES.revisedCutPdf),
  })
  await db
    .update(documentVersions)
    .set({ uploadedBy: s.editor.id })
    .where(eq(documentVersions.id, v2.id))
  await processVersion(deps(), v2.id)
  const docId = document.id

  // A quote the revision no longer has (inside the cut lines 201 to 240), and one it keeps.
  const v2Stream = buildWordStream((await loadVersionText(db, s.deps.blobs, v2.id)).layers)
  const gone = (q: string) =>
    findQuote(v2Stream, q, 'exact').length === 0 &&
    findQuote(v2Stream, q, 'normalised').length === 0
  const kept = (q: string) => findQuote(v2Stream, q, 'exact').length === 1
  const cutLine = await lineAnchor(s, docId, v1.id, 4, gone).catch(() =>
    lineAnchor(s, docId, v1.id, 5, gone),
  )
  const keptLine = await lineAnchor(s, docId, v1.id, 30, kept)

  const cue = (
    dept: 'LX' | 'SND',
    label: string,
    anchor: Anchor | null,
    major = 0,
    actor = s.actors.owner,
  ) =>
    createCue(db, actor, {
      showId: s.show.id,
      departmentId: s.depts[dept].id,
      number: { major, minor: 0 },
      label,
      anchor,
    })
  const note = (
    layer: { kind: 'department' | 'personal'; id: string },
    text: string,
    actor: typeof s.actors.owner,
    type: 'note' | 'highlight' = 'note',
    anchor: Anchor = cutLine,
  ) =>
    createAnnotation(db, actor, {
      showId: s.show.id,
      layerKind: layer.kind,
      layerId: layer.id,
      anchor,
      type,
      geometry: {},
      text,
      style: {},
    })

  const rows = {
    /** Moves cleanly: ends `ok` on v2, so it is not pending. */
    cueKept: await cue('LX', 'Kept', keptLine, 11),
    /** The cut-line cues: `unresolved` on v2, pending. */
    cueAccept: await cue('LX', 'Accept me', cutLine, 12),
    cueRevert: await cue('LX', 'Revert me', cutLine, 13),
    cueReanchor: await cue('LX', 'Fly out', cutLine, 14),
    cueSnd: await cue('SND', 'Out of scope', cutLine, 21),
    /** For the test that forges a run's agent string through another channel. */
    cueForge: await cue('LX', 'Forged', cutLine, 16),
    cueUnplaced: await cue('LX', 'Unplaced', null, 15),
    deptNote: await note(
      { kind: 'department', id: s.depts.SND.id },
      'Fly out early please',
      s.actors.owner,
    ),
    ownerNote: await note({ kind: 'personal', id: s.owner.id }, 'owner private', s.actors.owner),
    viewerNote: await note(
      { kind: 'personal', id: s.viewer.id },
      'viewer private',
      s.actors.viewer,
    ),
    highlight: await note(
      { kind: 'department', id: s.depts.LX.id },
      '',
      s.actors.owner,
      'highlight',
    ),
    movedNote: await note({ kind: 'personal', id: s.editor.id }, 'was private', s.actors.editor),
  }

  const jobs = new RecordingJobs()
  await reanchorVersion(deps(jobs), v2.id)

  // Made public after the run: its earlier history stays on the personal layer it was written on.
  await updateAnnotation(db, s.actors.editor, {
    annotationId: rows.movedNote.id,
    patch: { layerKind: 'department', layerId: s.depts.LX.id },
  })

  return { s, docId, v1: v1.id, v2: v2.id, cutLine, keptLine, rows }
}

export type RevisedFixture = Awaited<ReturnType<typeof buildRevisedFixture>>
