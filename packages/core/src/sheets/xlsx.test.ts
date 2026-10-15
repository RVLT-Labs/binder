import { strFromU8, unzipSync } from 'fflate'
import { expect, test } from 'vitest'
import { CUE_SHEET_COLUMNS, type CueSheetRow } from './cueSheet'
import { cueSheetXlsx } from './xlsx'

const row = (over: Partial<CueSheetRow> = {}): CueSheetRow => ({
  cue: '10',
  type: 'go',
  label: 'Lights up',
  page: 1,
  document: '',
  trigger: '',
  notes: '',
  status: '',
  ...over,
})
const sheetOf = (rows: CueSheetRow[], sheetName = 'LX') =>
  strFromU8(unzipSync(cueSheetXlsx(rows, { sheetName }))['xl/worksheets/sheet1.xml'] as Uint8Array)

test('XLSX unzips to the five parts; page is a number cell and the cue number a string', () => {
  const files = unzipSync(
    cueSheetXlsx([row({ cue: '10.50', page: 3 }), row({ cue: '11', page: null })], {
      sheetName: 'LX',
    }),
  )
  expect(Object.keys(files).sort()).toEqual([
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
  ])
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] as Uint8Array)
  expect(sheet).toContain('<c r="D2" t="n"><v>3</v></c>')
  expect(sheet).toContain('<t>10.50</t>')
  expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>10.50</t></is></c>')
  expect(sheet).not.toContain('r="D3" t="n"')
  expect(sheet).not.toContain('r="D3"')
})

test('the header row is the cue sheet columns, as strings', () => {
  const sheet = sheetOf([])
  CUE_SHEET_COLUMNS.forEach((name, i) => {
    expect(sheet).toContain(`<c r="${'ABCDEFGH'[i]}1" t="inlineStr"><is><t>${name}</t></is></c>`)
  })
})

test('the workbook names its one sheet, and the sheet name is made valid', () => {
  const book = (name: string) =>
    strFromU8(unzipSync(cueSheetXlsx([], { sheetName: name }))['xl/workbook.xml'] as Uint8Array)
  expect(book('LX')).toContain('<sheet name="LX" sheetId="1" r:id="rId1"/>')
  // Excel refuses : \ / ? * [ ] and more than 31 characters, and an empty name.
  expect(book('A/B:C*D?E[F]G\\H')).toContain('name="A-B-C-D-E-F-G-H"')
  expect(book('x'.repeat(40))).toContain(`name="${'x'.repeat(31)}"`)
  expect(book('')).toContain('name="Cue sheet"')
  expect(book("it's <&>")).toContain('name="it&apos;s &lt;&amp;&gt;"')
  // No leading or trailing apostrophe, and "History" is reserved.
  expect(book("'LX'")).toContain('name="LX"')
  expect(book("''x's''")).toContain('name="x&apos;s"')
  expect(book("'''")).toContain('name="Cue sheet"')
  expect(book('History')).toContain('name="History sheet"')
  expect(book('hISTORY')).toContain('name="hISTORY sheet"')
  expect(book('History of LX')).toContain('name="History of LX"')
})

test('XLSX escapes markup and drops control characters', () => {
  const sheet = sheetOf([
    row({ label: '<b>&', notes: 'a\u0000b\u0007c\u001fd\ttab\nline\r\nx', trigger: '"q" \'s\'' }),
  ])
  expect(sheet).toContain('<t>&lt;b&gt;&amp;</t>')
  expect(sheet).not.toContain('<b>')
  expect(sheet).toContain('abcd\ttab\nline\r\nx')
  const stray = [...sheet].filter((ch) => {
    const cp = ch.codePointAt(0) as number
    return cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d
  })
  expect(stray).toEqual([])
  expect(sheet).toContain('&quot;q&quot; &apos;s&apos;')
})

test('characters XML 1.0 cannot hold are dropped, astral characters kept', () => {
  const sheet = sheetOf([row({ label: 'a\ufffeb\uffffc\ud800d😀e' })])
  expect(sheet).toContain('<t>abcd😀e</t>')
})

test('leading and trailing spaces are kept', () => {
  expect(sheetOf([row({ label: ' padded ' })])).toContain('<t xml:space="preserve"> padded </t>')
})

test('blank cells are left out, and cells that read like formulas stay strings', () => {
  const sheet = sheetOf([row({ label: '=SUM(A1)', notes: '' })])
  expect(sheet).not.toContain('r="G2"')
  expect(sheet).toContain('<c r="C2" t="inlineStr"><is><t>=SUM(A1)</t></is></c>')
  expect(sheet).not.toContain('<f>')
})

test('a page is written as a number cell with exactly its value; a non-finite one is left blank', () => {
  expect(sheetOf([row({ page: 12.5 })])).toContain('<c r="D2" t="n"><v>12.5</v></c>')
  expect(sheetOf([row({ page: 120 })])).toContain('<c r="D2" t="n"><v>120</v></c>')
  expect(sheetOf([row({ page: 1234567 })])).toContain('<c r="D2" t="n"><v>1234567</v></c>')
  expect(sheetOf([row({ page: Number.NaN })])).not.toContain('r="D2"')
})

test('the package is deterministic', () => {
  const rows = [row({ cue: '10.50', page: 3 })]
  expect(cueSheetXlsx(rows, { sheetName: 'LX' })).toEqual(cueSheetXlsx(rows, { sheetName: 'LX' }))
})
