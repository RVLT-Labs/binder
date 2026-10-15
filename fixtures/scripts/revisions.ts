import { textToPdf } from './lib.ts'

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
