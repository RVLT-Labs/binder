import { PDFDocument, StandardFonts } from 'pdf-lib'
import { expect, test } from 'vitest'
import { toWinAnsi } from './winAnsi'

test('toWinAnsi keeps Latin-1 and CP1252 punctuation and replaces the rest', () =>
  expect(toWinAnsi('Ça va — “ok” ✓ 東京 🎭\nend')).toBe('Ça va — “ok” ? ?? ? end'))

test('line breaks of every kind become one space each', () =>
  expect(toWinAnsi('a\nb\r\nc\rd e f')).toBe('a b c d e f'))

test('the 27 CP1252 extras pass and the C1 controls do not', () => {
  const extras = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
  expect([...extras]).toHaveLength(27)
  expect(toWinAnsi(extras)).toBe(extras)
  expect(toWinAnsi('\u0080\u0081\u009f')).toBe('???')
  expect(toWinAnsi(' ¡ÿ')).toBe(' ¡ÿ')
})

test('controls, DEL and astral code points become one question mark each', () =>
  expect(toWinAnsi('\u0000\t\u007f😀')).toBe('????'))

test('everything it returns encodes in pdf-lib Helvetica without throwing', async () => {
  const font = await PDFDocument.create().then((d) => d.embedFont(StandardFonts.Helvetica))
  for (let cp = 0; cp < 0x3000; cp++) {
    const out = toWinAnsi(String.fromCodePoint(cp))
    expect(() => font.encodeText(out), `U+${cp.toString(16)}`).not.toThrow()
  }
})
