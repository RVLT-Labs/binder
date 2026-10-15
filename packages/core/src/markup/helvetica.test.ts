import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import { helveticaWidth } from './helvetica'

test('Helvetica widths follow the AFM: "LX 10" at 10 pt', () => {
  // L 556 + X 667 + space 278 + 1 556 + 0 556 = 2613 thousandths of an em.
  expect(helveticaWidth('LX 10', 10)).toBeCloseTo(26.13)
  expect(helveticaWidth('', 10)).toBe(0)
})

describe("agrees with pdf-lib's StandardFonts.Helvetica at 9 pt", () => {
  const font = PDFDocument.create().then((d) => d.embedFont(StandardFonts.Helvetica))

  test.each(['LX 10', 'SB SND 12.5', 'Fly in', '~!@#$%^&*()_+{}|:"<>?-=[];\',./`'])(
    'whole string %j',
    async (s) => expect(helveticaWidth(s, 9)).toBeCloseTo((await font).widthOfTextAtSize(s, 9), 6),
  )

  // widthOfTextAtSize applies kerning pairs ("Te", "AV"), but drawText sets the text in one Tj
  // without kerning, so the unkerned advance sum is what lands on the page: compare per character.
  test('every printable ASCII character, and a pangram summed unkerned', async () => {
    const f = await font
    let sum = 0
    for (let c = 32; c < 127; c++) {
      const ch = String.fromCharCode(c)
      expect(helveticaWidth(ch, 9)).toBeCloseTo(f.widthOfTextAtSize(ch, 9), 6)
    }
    const pangram = 'The quick brown fox jumps over the lazy dog 0123456789'
    for (const ch of pangram) sum += f.widthOfTextAtSize(ch, 9)
    expect(helveticaWidth(pangram, 9)).toBeCloseTo(sum, 6)
  })
})

describe('beyond ASCII', () => {
  test('accented letters and smart punctuation measure from the AFM, not a default', () => {
    // 'Ç' 722, em dash 1000, curly quotes 333 and 222, ellipsis 1000, bullet 350, euro 556.
    expect(helveticaWidth('Ç', 1000)).toBe(722)
    expect(helveticaWidth('—', 1000)).toBe(1000)
    expect(helveticaWidth('“”', 1000)).toBe(666)
    expect(helveticaWidth('’', 1000)).toBe(222)
    expect(helveticaWidth('…', 1000)).toBe(1000)
    expect(helveticaWidth('•', 1000)).toBe(350)
    expect(helveticaWidth('\u00a0', 1000)).toBe(278)
  })

  test('every WinAnsi character agrees with pdf-lib Helvetica', async () => {
    const f = await PDFDocument.create().then((d) => d.embedFont(StandardFonts.Helvetica))
    const chars = [
      ...Array.from({ length: 0x60 }, (_, i) => String.fromCodePoint(0xa0 + i)),
      ...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ',
    ]
    expect(chars).toHaveLength(96 + 27)
    for (const ch of chars) {
      expect(helveticaWidth(ch, 9), `U+${ch.codePointAt(0)?.toString(16)}`).toBeCloseTo(
        f.widthOfTextAtSize(ch, 9),
        6,
      )
    }
  })

  test('anything else keeps the 556 default', () => expect(helveticaWidth('東', 1000)).toBe(556))
})
