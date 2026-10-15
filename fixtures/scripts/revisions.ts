import { PDFDocument } from 'pdf-lib'
import { newDoc, textToPdf } from './lib.ts'

/** The libretto layout every fixture uses, so revisions line up with `pirates-libretto.pdf`. */
const LIBRETTO_LAYOUT = { pageSize: 'A4', fontSize: 11, linesPerPage: 48 } as const

/** The 1-based lines of `pirates.txt` that `revisedCutPdf` leaves out. */
export const CUT_FIRST_LINE = 201
export const CUT_LAST_LINE = 240
/** `revisedInsertPdf` adds this many `INSERTED LINE <n>` lines after line 240 of the text. */
export const INSERTED_LINE_COUNT = 48
export const INSERT_AFTER_LINE = 240

/** `text` without its 1-based lines `first` to `last`. */
export function cutLines(text: string, first: number, last: number): string {
  const lines = text.split('\n')
  return [...lines.slice(0, first - 1), ...lines.slice(last)].join('\n')
}

/** `text` with `count` lines `INSERTED LINE <n>` after its 1-based line `after`. */
export function insertLines(text: string, after: number, count: number): string {
  const lines = text.split('\n')
  const inserted = Array.from({ length: count }, (_, i) => `INSERTED LINE ${i + 1}`)
  return [...lines.slice(0, after), ...inserted, ...lines.slice(after)].join('\n')
}

/** The libretto with lines 201 to 240 cut: a revision that removes text. */
export function makeRevisedCutPdf(text: string): Promise<Uint8Array> {
  return textToPdf(cutLines(text, CUT_FIRST_LINE, CUT_LAST_LINE), LIBRETTO_LAYOUT)
}

/** The libretto with a page of 48 new lines after line 240: a revision that adds text. */
export function makeRevisedInsertPdf(text: string): Promise<Uint8Array> {
  return textToPdf(insertLines(text, INSERT_AFTER_LINE, INSERTED_LINE_COUNT), LIBRETTO_LAYOUT)
}

/** The 1-based lines of `pirates.txt` that `revisedShortCutPdf` leaves out: part of page 2. */
export const SHORT_CUT_FIRST_LINE = 60
export const SHORT_CUT_LAST_LINE = 75
/** The short fixtures are three pages long. */
export const SHORT_PAGE_COUNT = 3

/** The first `count` pages of a PDF given as bytes. */
async function firstPagesOf(bytes: Uint8Array, count: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false })
  const doc = await newDoc()
  const n = Math.min(count, src.getPageCount())
  for (const page of await doc.copyPages(src, [...Array(n).keys()])) doc.addPage(page)
  return doc.save()
}

/**
 * A three-page revision of `pirates-short.pdf`: the libretto with lines 60 to 75 of the text cut
 * (from page 2), then its first three pages. It processes in seconds, for revision e2e.
 */
export async function makeRevisedShortCutPdf(text: string): Promise<Uint8Array> {
  const full = await textToPdf(
    cutLines(text, SHORT_CUT_FIRST_LINE, SHORT_CUT_LAST_LINE),
    LIBRETTO_LAYOUT,
  )
  return firstPagesOf(full, SHORT_PAGE_COUNT)
}
