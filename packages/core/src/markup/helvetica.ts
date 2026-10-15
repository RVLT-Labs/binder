/** Helvetica advance widths (thousandths of an em) for ASCII 32 to 126, as in its AFM. */
const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

/** The same for U+00A0 to U+00FF (Latin-1), in the order of the code points. */
const LATIN1 = [
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333,
  333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667,
  1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778,
  722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556,
  278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556,
  500,
]

/** The 27 CP1252 characters outside Latin-1 that WinAnsi carries. */
const CP1252: Record<string, number> = {
  '€': 556,
  '‚': 222,
  ƒ: 556,
  '„': 333,
  '…': 1000,
  '†': 556,
  '‡': 556,
  ˆ: 333,
  '‰': 1000,
  Š: 667,
  '‹': 333,
  Œ: 1000,
  Ž: 611,
  '‘': 222,
  '’': 222,
  '“': 333,
  '”': 333,
  '•': 350,
  '–': 556,
  '—': 1000,
  '˜': 333,
  '™': 1000,
  š: 500,
  '›': 333,
  œ: 944,
  ž: 500,
  Ÿ: 500,
}

/** Anything outside WinAnsi is measured as a typical letter. */
const DEFAULT_ADVANCE = 556

function advance(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp >= 32 && cp <= 126) return ASCII[cp - 32] ?? DEFAULT_ADVANCE
  if (cp >= 0xa0 && cp <= 0xff) return LATIN1[cp - 0xa0] ?? DEFAULT_ADVANCE
  return CP1252[ch] ?? DEFAULT_ADVANCE
}

/** The width of `text` set in Helvetica (Arial has the same metrics) at `size` points, unkerned. */
export function helveticaWidth(text: string, size: number): number {
  let units = 0
  for (const ch of text) units += advance(ch)
  return (units * size) / 1000
}
