import {
  anchorAtMatch,
  buildWordStream,
  clampOffset,
  findQuote,
  type QuoteMatch,
  type StreamWord,
  withMark,
} from '@binder/core'
import {
  type Actor,
  type Anchor,
  CUE_MARKS,
  type CueMark,
  type CueNumber,
  type CueType,
  isCaretMark,
  markOf,
  type WordLayer,
} from '@binder/shared'
import type { BlobStore } from '../blob/BlobStore'
import { invalid, notFound } from '../errors'
import { type CueView, createCue, getCue } from './cues'
import { listDepartments } from './departments'
import { getDocument, listDocuments } from './documents'
import type { Executor } from './executor'
import { requireLayerEdit } from './layers'
import { requireShowRole } from './tenancy'
import { loadVersionText } from './wordLayers'

const SNIPPET_CONTEXT_WORDS = 4
const MAX_AMBIGUOUS = 20
/** The most characters into a word a line or pointer can sit; far beyond any real word. */
export const MAX_CHAR_OFFSET = 1000

function checkMark(mark: CueMark | undefined): void {
  if (mark !== undefined && !CUE_MARKS.includes(mark)) {
    throw invalid(`mark must be one of ${CUE_MARKS.join(', ')}`)
  }
}

function checkCharOffset(charOffset: number | undefined, mark: CueMark): void {
  if (charOffset === undefined) return
  if (!Number.isInteger(charOffset) || charOffset < 0 || charOffset > MAX_CHAR_OFFSET) {
    throw invalid(`charOffset must be a whole number from 0 to ${MAX_CHAR_OFFSET}`)
  }
  if (!isCaretMark(mark)) throw invalid('charOffset only applies to a line or pointer mark')
}

/**
 * The anchor an `update_cue` call that restyles ends with: `current` (the cue's anchor now, null when
 * unplaced) or the new `change.anchor` (applied first), drawn with `change.mark` and/or a character
 * offset. `mark` defaults to the base anchor's own; the offset applies to the word at
 * `text.wordStart`, clamped to its length, and `x` follows the caret when the page's word layer can
 * be read (otherwise the change still applies). `invalid` when the cue is unplaced, when the call
 * also sets `anchor: null` (it would both unplace and restyle the cue), or when `charOffset` is
 * given and no word is bound or the mark is not a line or pointer.
 */
export async function restyleAnchor(
  db: Executor,
  blobs: BlobStore,
  current: Anchor | null,
  change: { anchor?: Anchor | null; mark?: CueMark; charOffset?: number },
): Promise<Anchor> {
  if (change.anchor === null) {
    throw invalid(
      'this call both unplaces the cue (anchor: null) and restyles it (mark or charOffset); do one or the other',
    )
  }
  const anchor = change.anchor ?? current
  if (!anchor) throw invalid('the cue is unplaced; place it before changing its mark')
  checkMark(change.mark)
  const mark = change.mark ?? markOf(anchor)
  checkCharOffset(change.charOffset, mark)
  const bound = anchor.text !== undefined && anchor.text.wordStart >= 0
  if (change.charOffset !== undefined && !bound) {
    throw invalid('charOffset needs a cue anchored to a word; this cue is not bound to any')
  }
  let layer: WordLayer | undefined
  if (bound && isCaretMark(mark)) {
    try {
      layer = (await loadVersionText(db, blobs, anchor.documentVersionId)).layers.get(
        anchor.pageIndex,
      )
    } catch {
      layer = undefined
    }
  }
  return withMark(anchor, mark, { layer, offset: change.charOffset })
}

export interface PlaceCueAtTextInput {
  showId: string
  /** A department code (any case) or id. */
  department: string
  quote: string
  documentId?: string
  /** 1-based, in script order, when the quote appears more than once. */
  occurrence?: number
  /** When the quote appears more than once, the occurrence nearest this page (earlier on a tie). */
  nearPageIndex?: number
  number?: CueNumber
  label?: string
  type?: CueType
  notes?: string
  /** How the cue is drawn; default underline. A highlight covers the whole matched quote. */
  mark?: CueMark
  /** Characters into the quote's first word for a line or pointer mark (default 0). */
  charOffset?: number
  batchId?: string
}

export type PlaceCueAtTextResult =
  | { status: 'placed'; cue: CueView; match: { pageIndex: number; snippet: string } }
  | {
      status: 'ambiguous'
      matches: Array<{ occurrence: number; pageIndex: number; snippet: string }>
    }

function snippetOf(stream: StreamWord[], m: QuoteMatch): string {
  return stream
    .slice(
      Math.max(0, m.start - SNIPPET_CONTEXT_WORDS),
      Math.min(stream.length, m.end + SNIPPET_CONTEXT_WORDS + 1),
    )
    .map((w) => w.t)
    .join(' ')
}

/**
 * Editor on the department's layer. Anchors a cue where `quote` occurs in a document's current
 * version (exact matches first, then case, punctuation and hyphenation tolerant ones). When the
 * quote occurs several times, `occurrence` or `nearPageIndex` picks one; otherwise nothing is
 * written and the matches are returned for the caller to choose from. `mark` says how the cue is
 * drawn: a highlight anchors the whole matched quote, a line or pointer sits `charOffset`
 * characters into the quote's first word.
 */
export async function placeCueAtText(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: PlaceCueAtTextInput,
): Promise<PlaceCueAtTextResult> {
  await requireShowRole(db, actor, input.showId, 'viewer')
  const ref = input.department.trim()
  const departments = await listDepartments(db, actor, { showId: input.showId })
  const department =
    departments.find((d) => d.id === ref) ?? departments.find((d) => d.code === ref.toUpperCase())
  if (!department) throw invalid(`unknown department: ${input.department}`)
  await requireLayerEdit(db, actor, input.showId, { kind: 'department', id: department.id })
  if (!input.quote.trim()) throw invalid('quote must not be empty')
  checkMark(input.mark)
  const mark = input.mark ?? 'underline'
  checkCharOffset(input.charOffset, mark)
  if (
    input.occurrence !== undefined &&
    (!Number.isInteger(input.occurrence) || input.occurrence < 1)
  ) {
    throw invalid('occurrence must be a whole number from 1')
  }

  let documentId = input.documentId
  if (documentId === undefined) {
    const docs = await listDocuments(db, actor, { showId: input.showId })
    const doc = docs.find((d) => d.kind === 'libretto') ?? docs[0]
    if (!doc) throw invalid('the show has no documents to place a cue in')
    documentId = doc.id
  }
  const { document, version } = await getDocument(db, actor, { documentId })
  if (document.showId !== input.showId) throw notFound('Document not found')
  if (!version || version.id !== document.currentVersionId) {
    throw invalid(`"${document.title}" has no current version`)
  }
  if (version.status !== 'ready') {
    throw invalid(
      `"${document.title}" is still being processed (${version.status}); try again shortly`,
    )
  }

  const text = await loadVersionText(db, blobs, version.id)
  const stream = buildWordStream(text.layers)
  let matches = findQuote(stream, input.quote, 'exact')
  if (matches.length === 0) matches = findQuote(stream, input.quote, 'normalised')
  if (matches.length === 0) throw notFound(`The quote was not found in "${document.title}"`)

  let chosen: QuoteMatch | undefined
  if (input.occurrence !== undefined) {
    chosen = matches[input.occurrence - 1]
    if (!chosen) {
      throw invalid(`occurrence ${input.occurrence}: the quote appears ${matches.length} times`)
    }
  } else if (matches.length === 1) {
    chosen = matches[0]
  } else if (input.nearPageIndex !== undefined) {
    const near = input.nearPageIndex
    let best = Number.POSITIVE_INFINITY
    for (const m of matches) {
      const page = (stream[m.start] as StreamWord).pageIndex
      const distance = Math.abs(page - near)
      // Strictly nearer wins; on a tie the earlier page, and matches are in stream order.
      if (distance < best) {
        best = distance
        chosen = m
      }
    }
  }

  if (!chosen) {
    return {
      status: 'ambiguous',
      matches: matches.slice(0, MAX_AMBIGUOUS).map((m, i) => ({
        occurrence: i + 1,
        pageIndex: (stream[m.start] as StreamWord).pageIndex,
        snippet: snippetOf(stream, m),
      })),
    }
  }

  const at = anchorAtMatch(
    stream,
    chosen,
    text,
    mark === 'highlight' ? Number.POSITIVE_INFINITY : undefined,
  )
  const layer = text.layers.get(at.pageIndex) as WordLayer
  const first = layer.words[at.text.wordStart]
  const length = first ? clampOffset(first.t, Number.POSITIVE_INFINITY) : 0
  if (input.charOffset !== undefined && input.charOffset > length) {
    throw invalid(
      `charOffset ${input.charOffset} is past the end of "${first?.t}" (${length} characters)`,
    )
  }
  const anchor = withMark(
    {
      documentId: document.id,
      documentVersionId: version.id,
      pageIndex: at.pageIndex,
      x: at.x,
      y: at.y,
      text: at.text,
      status: 'ok',
    },
    mark,
    { layer, offset: input.charOffset },
  )
  const cue = await createCue(db, actor, {
    showId: input.showId,
    departmentId: department.id,
    number: input.number,
    label: input.label,
    type: input.type,
    notes: input.notes,
    batchId: input.batchId,
    anchor,
  })
  return {
    status: 'placed',
    cue: await getCue(db, actor, { cueId: cue.id }),
    match: { pageIndex: at.pageIndex, snippet: snippetOf(stream, chosen) },
  }
}
