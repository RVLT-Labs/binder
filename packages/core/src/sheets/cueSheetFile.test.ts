import { EXPORT_FILE_TYPES } from '@binder/shared'
import { strFromU8, unzipSync } from 'fflate'
import { expect, test } from 'vitest'
import { CUE_SHEET_COLUMNS, type CueSheetRow } from './cueSheet'
import { cueSheetFile } from './cueSheetFile'

const BOM = String.fromCharCode(0xfeff)
const rows: CueSheetRow[] = [
  { cue: '10', type: 'go', label: 'Up', page: 2, document: '', trigger: '', notes: '', status: '' },
]
const opts = {
  title: 'Show LX cue sheet',
  sheetName: 'LX',
  paper: 'A4' as const,
  footer: {
    showTitle: 'Show',
    documentLabel: 'LX cue sheet',
    layerLabel: 'LX',
    binderVersion: null,
    exportId: '0190f3a2-0000-7000-8000-00000000abcd',
    date: new Date(2026, 9, 15, 14, 2),
  },
}

test('each format comes back with its stored kind, extension, media type and the right signature', async () => {
  const pdf = await cueSheetFile('pdf', rows, opts)
  expect(pdf).toMatchObject({ kind: 'pdf-sheet', ext: 'pdf', mime: 'application/pdf' })
  expect(strFromU8(pdf.bytes.subarray(0, 5))).toBe('%PDF-')

  const xlsx = await cueSheetFile('xlsx', rows, opts)
  expect(xlsx).toMatchObject({ kind: 'xlsx', ext: 'xlsx' })
  expect(strFromU8(xlsx.bytes.subarray(0, 2))).toBe('PK')
  expect(strFromU8(unzipSync(xlsx.bytes)['xl/workbook.xml'] as Uint8Array)).toContain('name="LX"')

  const csv = await cueSheetFile('csv', rows, opts)
  expect(csv).toMatchObject({ kind: 'csv', ext: 'csv', mime: 'text/csv' })
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(csv.bytes)).toBe(
    `${BOM}${CUE_SHEET_COLUMNS.join(',')}\r\n10,go,Up,2,,,,\r\n`,
  )
})

test('the metadata is the shared export table, and its signatures match the bytes made', async () => {
  for (const format of ['pdf', 'xlsx', 'csv'] as const) {
    const file = await cueSheetFile(format, rows, opts)
    const type = EXPORT_FILE_TYPES[file.kind]
    expect([file.ext, file.mime]).toEqual([type.ext, type.mime])
    if (type.magic) expect(strFromU8(file.bytes.subarray(0, type.magic.length))).toBe(type.magic)
  }
})

test('an unknown format is an error', async () => {
  await expect(cueSheetFile('docx' as 'pdf', rows, opts)).rejects.toThrow(
    /unknown cue sheet format/,
  )
})
