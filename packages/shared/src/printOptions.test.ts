import { describe, expect, test } from 'vitest'
import {
  normalisePageRange,
  parsePageRange,
  printOptionsSchema,
  sanitizeExportFilename,
  scriptExportFilename,
  validateExportFilename,
} from './printOptions'

describe('parsePageRange', () => {
  test('accepts 1–43, "3, 7-9" and the other dash forms, as zero-based indices', () => {
    const all = parsePageRange('1–43', 43)
    expect(all).toMatchObject({ ok: true })
    expect(all.ok && all.indices).toEqual(Array.from({ length: 43 }, (_, i) => i))
    expect(parsePageRange('3, 7-9', 43)).toEqual({ ok: true, indices: [2, 6, 7, 8] })
    expect(parsePageRange('7—9,3', 43)).toEqual({ ok: true, indices: [2, 6, 7, 8] })
    expect(parsePageRange(' 5 ', 43)).toEqual({ ok: true, indices: [4] })
    expect(parsePageRange('2-4, 3-6, 2', 43)).toEqual({ ok: true, indices: [1, 2, 3, 4, 5] })
  })

  test('rejects 0, 44, "a-b", reversed ranges and empty text with the plain messages', () => {
    expect(parsePageRange('44', 43)).toEqual({
      ok: false,
      reason: 'beyond',
      message: 'This script has 43 pages.',
    })
    expect(parsePageRange('40-44', 43)).toMatchObject({ ok: false, reason: 'beyond' })
    for (const bad of ['0', '0-3', 'a-b', '', '  ', '5-3', '1,,2', '1-', '-3', '1 2', '1.5']) {
      expect(parsePageRange(bad, 43)).toEqual({
        ok: false,
        reason: 'syntax',
        message: 'Pages look like 1–43 or 3, 7–9.',
      })
    }
  })

  test('a one-page script says so', () => {
    expect(parsePageRange('2', 1)).toMatchObject({ ok: false, message: 'This script has 1 page.' })
  })
})

describe('normalisePageRange', () => {
  test('merges and sorts into the canonical ASCII text', () => {
    expect(normalisePageRange('8, 5–1')).toBeNull()
    expect(normalisePageRange('8, 1–5')).toBe('1-5, 8')
    expect(normalisePageRange('3,1,2, 5—6,6')).toBe('1-3, 5-6')
    expect(normalisePageRange('4-5, 1-3')).toBe('1-5')
    expect(normalisePageRange('7')).toBe('7')
    expect(normalisePageRange('nope')).toBeNull()
  })
})

describe('validateExportFilename', () => {
  test('rejects / \\ : * ? " < > |, control characters, CON, a leading dot and 201 characters', () => {
    for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
      const r = validateExportFilename(`a${ch}b`)
      expect(r).toEqual({ ok: false, reason: `File names can't contain / \\ : * ? " < > |` })
    }
    expect(validateExportFilename('a\u0007b')).toMatchObject({ ok: false })
    expect(validateExportFilename('CON')).toMatchObject({ ok: false })
    expect(validateExportFilename('com1.pdf')).toMatchObject({ ok: false })
    expect(validateExportFilename('lpt9')).toMatchObject({ ok: false })
    expect(validateExportFilename('.hidden')).toMatchObject({ ok: false })
    expect(validateExportFilename('name.')).toMatchObject({ ok: false })
    expect(validateExportFilename('name .pdf')).toMatchObject({ ok: false })
    expect(validateExportFilename('')).toMatchObject({ ok: false })
    expect(validateExportFilename('   ')).toMatchObject({ ok: false })
    expect(validateExportFilename('.pdf')).toMatchObject({ ok: false })
    expect(validateExportFilename('a'.repeat(197))).toMatchObject({ ok: false })
    expect(validateExportFilename(`${'a'.repeat(197)}.pdf`)).toMatchObject({ ok: false })
    expect(validateExportFilename('a'.repeat(196))).toEqual({
      ok: true,
      name: `${'a'.repeat(196)}.pdf`,
    })
  })

  test('re-adds a single .pdf', () => {
    expect(validateExportFilename('  My script  ')).toEqual({ ok: true, name: 'My script.pdf' })
    expect(validateExportFilename('My script.pdf')).toEqual({ ok: true, name: 'My script.pdf' })
    expect(validateExportFilename('My script.PDF')).toEqual({ ok: true, name: 'My script.pdf' })
    expect(validateExportFilename('v1.2')).toEqual({ ok: true, name: 'v1.2.pdf' })
    expect(validateExportFilename('Songs – café ✓')).toEqual({
      ok: true,
      name: 'Songs – café ✓.pdf',
    })
  })
})

describe('scriptExportFilename', () => {
  const base = {
    show: 'Songs for a New World',
    document: 'Libretto',
    versionNumber: 2,
  }
  test('produces songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf', () => {
    expect(scriptExportFilename({ ...base, layerLabel: 'LX, SND, TM' })).toBe(
      'songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf',
    )
  })

  test('says all-layers, clean or personal where the layer label does', () => {
    expect(scriptExportFilename({ ...base, layerLabel: 'All layers' })).toBe(
      'songs-for-a-new-world-libretto-v2-all-layers.pdf',
    )
    expect(scriptExportFilename({ ...base, layerLabel: 'All layers + personal' })).toBe(
      'songs-for-a-new-world-libretto-v2-all-layers-personal.pdf',
    )
    expect(scriptExportFilename({ ...base, layerLabel: 'Clean copy' })).toBe(
      'songs-for-a-new-world-libretto-v2-clean.pdf',
    )
    expect(scriptExportFilename({ ...base, layerLabel: 'Personal' })).toBe(
      'songs-for-a-new-world-libretto-v2-personal.pdf',
    )
    expect(scriptExportFilename({ ...base, layerLabel: 'LX, TM + personal' })).toBe(
      'songs-for-a-new-world-libretto-v2-LX-TM-personal.pdf',
    )
  })

  test('slugs accents and punctuation, never gives an empty slug and passes validation', () => {
    const name = scriptExportFilename({
      show: 'Café "Noir": the Musical?',
      document: '***',
      versionNumber: 10,
      layerLabel: 'Clean copy',
    })
    expect(name).toBe('cafe-noir-the-musical-untitled-v10-clean.pdf')
    const long = scriptExportFilename({
      show: 'x'.repeat(300),
      document: 'y'.repeat(300),
      versionNumber: 1,
      layerLabel: 'All layers',
    })
    expect(long.length).toBeLessThanOrEqual(200)
    expect(long.endsWith('.pdf')).toBe(true)
    expect(validateExportFilename(long)).toEqual({ ok: true, name: long })
  })
})

describe('printOptionsSchema', () => {
  test('fills the defaults and leaves paper absent', () => {
    expect(printOptionsSchema.parse({})).toEqual({
      pages: 'all',
      includeStandbyWarn: true,
      includeAnnotations: true,
      includeCueNotes: true,
    })
  })

  test('accepts a normalised range and a paper, and rejects junk', () => {
    expect(printOptionsSchema.parse({ pages: '1-5, 8', paper: 'Letter' })).toMatchObject({
      pages: '1-5, 8',
      paper: 'Letter',
    })
    expect(printOptionsSchema.safeParse({ pages: 'nope' }).success).toBe(false)
    expect(printOptionsSchema.safeParse({ pages: '' }).success).toBe(false)
    expect(printOptionsSchema.safeParse({ paper: 'A3' }).success).toBe(false)
    expect(printOptionsSchema.safeParse({ includeCueNotes: 'yes' }).success).toBe(false)
  })
})

describe('sanitizeExportFilename', () => {
  const cases = [
    'Pirates: A/B - Libretto v2 - LX + personal.pdf',
    'a?b*c"d<e>f|g\\h.pdf',
    '  .leading and trailing dots.. .pdf',
    `${'x'.repeat(400)}.pdf`,
    `${'word '.repeat(60)}.pdf`,
    'CON.pdf',
    'con',
    'NUL.pdf.pdf',
    'lpt1.txt.pdf',
    '',
    '   ',
    '...',
    '.pdf',
    'tab\there\u0000.pdf',
    'Hello.',
    '日本語のスクリプト.PDF',
  ]
  test.each(cases)('always gives a name validateExportFilename accepts: %j', (raw) => {
    const name = sanitizeExportFilename(raw)
    const checked = validateExportFilename(name)
    expect(checked).toEqual({ ok: true, name })
    expect(name.endsWith('.pdf')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(200)
  })

  test('replaces forbidden characters with a hyphen and keeps the rest', () => {
    expect(sanitizeExportFilename('Pirates: A/B - Libretto v2.pdf')).toBe(
      'Pirates- A-B - Libretto v2.pdf',
    )
  })

  test('trims spaces and dots at both ends, before the extension too', () => {
    expect(sanitizeExportFilename('  ..Show - Doc v1 - LX . .pdf')).toBe('Show - Doc v1 - LX.pdf')
    expect(sanitizeExportFilename('Show.')).toBe('Show.pdf')
  })

  test('a reserved Windows name gets a suffix, the extension stays', () => {
    expect(sanitizeExportFilename('CON.pdf')).toBe('CON-export.pdf')
    expect(sanitizeExportFilename('aux')).toBe('aux-export.pdf')
  })

  test('caps the length at 200 characters in all, keeping .pdf, and does not leave a dangling space', () => {
    const name = sanitizeExportFilename(`${'ab '.repeat(100)}.pdf`)
    expect(name.length).toBeLessThanOrEqual(200)
    expect(name.endsWith('.pdf')).toBe(true)
    expect(name.endsWith(' .pdf')).toBe(false)
  })

  test('a name that is nothing usable becomes "export.pdf"', () => {
    expect(sanitizeExportFilename('')).toBe('export.pdf')
    expect(sanitizeExportFilename(' ... ')).toBe('export.pdf')
  })

  test('a name that is already valid is unchanged', () => {
    expect(sanitizeExportFilename('songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf')).toBe(
      'songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf',
    )
  })
})
