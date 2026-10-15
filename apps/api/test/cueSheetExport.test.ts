import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { exportRecords } from '@binder/db'
import { newId } from '@binder/shared'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { readBlobBytes } from '../src/blob/BlobStore'
import { AppError } from '../src/errors'
import {
  createCue,
  createShow,
  createToken,
  exportCueList,
  listOrganisations,
  updateShow,
} from '../src/services'
import type { Json } from './documentHelpers'
import { asJson, blobFiles, multipart } from './documentHelpers'
import { APP_ORIGIN } from './helpers'
import { anchorAt, setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'
import { findMissingTools, skipWithoutTools } from './tools'

const run = promisify(execFile)
const skipPoppler = skipWithoutTools(
  'cue sheet pdf test',
  findMissingTools([['pdftotext', ['-v']]]),
)

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
let s: Setup
let owner: Client
let viewer: Client
let scoped: Client
let work: string
const clients: Client[] = []

const QUOTE = 'a pirate king'
const BOM = String.fromCharCode(0xfeff)
/** Decodes without dropping the byte order mark, which `TextDecoder` removes by default. */
const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

async function connect(userId: string, showScope: '*' | string[] = '*') {
  const actor = { userId, via: 'web' as const, agent: null }
  const { token } = await createToken(s.deps.db, actor, { name: 't', showScope })
  const c = await connectMcp(s.app, token)
  clients.push(c)
  return c
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : `other: ${e}`),
  )

const bytesOf = async (rec: { fileKey: string }) => {
  const bytes = await readBlobBytes(s.deps.blobs, rec.fileKey)
  if (!bytes) throw new Error('export blob missing')
  return new Uint8Array(bytes)
}

beforeAll(async () => {
  s = await setupMarkupShow()
  work = await mkdtemp(join(tmpdir(), 'binder-sheet-test-'))
  const db = s.deps.db
  const lx = s.depts.LX.id
  // LX 10 snapped to a quote on page 3; a duplicate 10.5; an unplaced 20; a TM cue that must not appear.
  await createCue(db, s.actors.owner, {
    showId: s.show.id,
    departmentId: lx,
    number: { major: 10, minor: 0 },
    label: 'Pirate king lights',
    notes: 'slow, "warm"',
    anchor: {
      ...anchorAt(s.docId, s.versionId, 2),
      text: { quote: QUOTE, wordStart: 4, wordEnd: 6 },
    },
  })
  await createCue(db, s.actors.owner, {
    showId: s.show.id,
    departmentId: lx,
    number: { major: 10, minor: 50 },
    label: '=SUM(1)',
    anchor: anchorAt(s.docId, s.versionId, 3),
  })
  await createCue(db, s.actors.owner, {
    showId: s.show.id,
    departmentId: lx,
    number: { major: 20, minor: 0 },
    label: 'Unplaced',
  })
  await createCue(db, s.actors.owner, {
    showId: s.show.id,
    departmentId: s.depts.TM.id,
    number: { major: 99, minor: 0 },
    label: 'Mic check',
  })
  owner = await connect(s.owner.id)
  viewer = await connect(s.viewer.id)
  const [org] = await listOrganisations(db, s.actors.owner)
  const elsewhere = await createShow(db, s.actors.owner, {
    organisationId: org.id,
    title: 'Elsewhere',
  })
  scoped = await connect(s.owner.id, [elsewhere.id])
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
  await rm(work, { recursive: true, force: true })
})

describe('export_cue_list', () => {
  test('csv stores a record whose blob starts with the BOM and lists LX 10 with its trigger quote', async () => {
    const res = await callTool(owner, 'export_cue_list', {
      showId: s.show.id,
      department: 'LX',
      format: 'csv',
    })
    expect(res.isError).toBeFalsy()
    const { record, uri } = res.structuredContent as Json
    expect(uri).toBe(`binder://shows/${s.show.id}/exports/${record.id}`)
    expect(record).toMatchObject({
      kind: 'csv',
      showId: s.show.id,
      filename: 'Show - LX cue sheet.csv',
      privateTo: null,
      layerSelection: [{ kind: 'department', id: s.depts.LX.id }],
    })
    const link = res.content.find((c) => c.type === 'resource_link')
    expect(link).toMatchObject({ uri, mimeType: 'text/csv', name: record.filename })

    const bytes = await bytesOf(record)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = utf8(bytes)
    expect(csv.startsWith(`${BOM}Cue,Type,Label,Page,Document,Trigger,Notes,Status\r\n`)).toBe(true)
    expect(csv).toContain(`10,go,Pirate king lights,3,,${QUOTE},"slow, ""warm""",\r\n`)
    // Number order, the formula guard, an unplaced cue last with a blank page; no other department.
    const lines = csv.split('\r\n')
    expect(lines[2]).toContain("10.5,go,'=SUM(1),4,")
    expect(lines[3]).toBe('20,go,Unplaced,,,,,')
    expect(csv).not.toContain('Mic check')
  })

  test('csv: the resource reads back as text/csv', async () => {
    const res = await callTool(viewer, 'export_cue_list', {
      departmentId: s.depts.LX.id,
      format: 'csv',
    })
    expect(res.isError).toBeFalsy()
    const { uri } = res.structuredContent as Json
    const read = await viewer.readResource({ uri })
    const [content] = read.contents as Json[]
    expect(content.mimeType).toContain('text/csv')
  })

  test('xlsx stores a record whose blob starts with PK and unzips to a sheet listing LX 10', async () => {
    const res = await callTool(owner, 'export_cue_list', {
      showId: s.show.id,
      department: 'lx',
      format: 'xlsx',
    })
    expect(res.isError).toBeFalsy()
    const { record } = res.structuredContent as Json
    expect(record).toMatchObject({ kind: 'xlsx', filename: 'Show - LX cue sheet.xlsx' })
    const link = res.content.find((c) => c.type === 'resource_link')
    expect(link?.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const bytes = await bytesOf(record)
    expect(strFromU8(bytes.subarray(0, 2))).toBe('PK')
    const files = unzipSync(bytes)
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] as Uint8Array)
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>10</t></is></c>')
    expect(sheet).toContain(`<t>${QUOTE}</t>`)
    expect(sheet).toContain('<c r="D2" t="n"><v>3</v></c>')
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t>10.5</t></is></c>')
    expect(sheet).not.toContain('Mic check')
    expect(strFromU8(files['xl/workbook.xml'] as Uint8Array)).toContain('name="LX"')
  })

  test.skipIf(skipPoppler)(
    'pdf: pdftotext of the blob contains the cue numbers and the footer',
    async () => {
      const res = await callTool(owner, 'export_cue_list', {
        showId: s.show.id,
        department: 'LX',
        format: 'pdf',
      })
      expect(res.isError).toBeFalsy()
      const { record } = res.structuredContent as Json
      expect(record).toMatchObject({ kind: 'pdf-sheet', filename: 'Show - LX cue sheet.pdf' })
      const link = res.content.find((c) => c.type === 'resource_link')
      expect(link?.mimeType).toBe('application/pdf')
      const bytes = await bytesOf(record)
      expect(strFromU8(bytes.subarray(0, 5))).toBe('%PDF-')
      const path = join(work, `${newId()}.pdf`)
      await writeFile(path, bytes)
      const text = (await run('pdftotext', ['-layout', path, '-'])).stdout
      expect(text).toContain('Pirate king lights')
      expect(text).toContain(QUOTE)
      expect(text).toMatch(/^\s*10\s/m)
      expect(text).toMatch(/^\s*10\.5\s/m)
      expect(text).toMatch(/^\s*20\s/m)
      expect(text).not.toContain('Mic check')
      // The footer, with the record's own id tail and the time zone the API runs in.
      expect(text).toContain(`Show · LX cue sheet · LX · export ${record.id.slice(-8)} · `)
      expect(text).toContain('Page 1 of 1')
      // A4 by default.
      const doc = await PDFDocument.load(bytes)
      expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1)
    },
  )

  test("the pdf follows the show's paper size", async () => {
    const fresh = await setupMarkupShow()
    const before = await exportCueList(fresh.deps.db, fresh.deps.blobs, fresh.actors.viewer, {
      departmentId: fresh.depts.LX.id,
      format: 'pdf',
    })
    const a4 = await PDFDocument.load(
      new Uint8Array((await readBlobBytes(fresh.deps.blobs, before.record.fileKey)) as Buffer),
    )
    expect(a4.getPage(0).getHeight()).toBeCloseTo(841.89, 1)
    await updateShow(fresh.deps.db, fresh.actors.owner, {
      showId: fresh.show.id,
      patch: { settings: { paperSize: 'Letter' } },
    })
    const after = await exportCueList(fresh.deps.db, fresh.deps.blobs, fresh.actors.viewer, {
      departmentId: fresh.depts.LX.id,
      format: 'pdf',
    })
    const letter = await PDFDocument.load(
      new Uint8Array((await readBlobBytes(fresh.deps.blobs, after.record.fileKey)) as Buffer),
    )
    expect([letter.getPage(0).getWidth(), letter.getPage(0).getHeight()]).toEqual([612, 792])
  })

  test('a department needs a show unless it is an id, and exactly one of department and departmentId', async () => {
    const asked = async (args: Record<string, unknown>) => {
      const r = await callTool(owner, 'export_cue_list', { format: 'csv', ...args })
      return r.isError ? resultText(r) : 'ok'
    }
    expect(await asked({ department: 'LX' })).toMatch(/showId/)
    expect(await asked({})).toMatch(/department/)
    expect(
      await asked({ department: 'LX', departmentId: s.depts.LX.id, showId: s.show.id }),
    ).toMatch(/either/)
    expect(await asked({ showId: s.show.id, department: 'NOPE' })).toMatch(
      /invalid.*unknown department/,
    )
    expect(await asked({ showId: s.show.id, departmentId: s.depts.SND.id })).toBe('ok')
    expect(await asked({ departmentId: newId() })).toMatch(/not_found|not found/i)
    // A department id from a show other than the one named is refused, not exported.
    const other = await setupMarkupShow()
    expect(await asked({ showId: s.show.id, departmentId: other.depts.LX.id })).toMatch(/invalid/)
  })

  test("another show's token is forbidden, and a non-member cannot tell a department exists", async () => {
    const res = await callTool(scoped, 'export_cue_list', {
      departmentId: s.depts.LX.id,
      format: 'csv',
    })
    expect(res.isError).toBe(true)
    expect(resultText(res)).toMatch(/forbidden/)
    const outsider = { userId: s.outsider.id, via: 'web' as const, agent: null }
    expect(
      await code(
        exportCueList(s.deps.db, s.deps.blobs, outsider, {
          departmentId: s.depts.LX.id,
          format: 'csv',
        }),
      ),
    ).toBe('not_found')
    expect(
      await code(
        exportCueList(s.deps.db, s.deps.blobs, outsider, { departmentId: newId(), format: 'csv' }),
      ),
    ).toBe('not_found')
  })
})

describe('exportCueList', () => {
  test('a viewer can export, an unknown format is invalid, and an archived show still exports (M1-R20)', async () => {
    const fresh = await setupMarkupShow()
    expect(
      await code(
        exportCueList(fresh.deps.db, fresh.deps.blobs, fresh.actors.viewer, {
          departmentId: fresh.depts.LX.id,
          format: 'docx' as 'pdf',
        }),
      ),
    ).toBe('invalid')
    await updateShow(fresh.deps.db, fresh.actors.owner, {
      showId: fresh.show.id,
      patch: { status: 'archived' },
    })
    const { record } = await exportCueList(fresh.deps.db, fresh.deps.blobs, fresh.actors.viewer, {
      departmentId: fresh.depts.LX.id,
      format: 'csv',
    })
    expect(record).toMatchObject({ createdBy: fresh.viewer.id, kind: 'csv' })
    const stored = await fresh.deps.db
      .select()
      .from(exportRecords)
      .where(eq(exportRecords.id, record.id))
    expect(stored).toHaveLength(1)
  })

  test('a department with no cues exports the header alone, and a show title with slashes is made safe', async () => {
    const fresh = await setupMarkupShow()
    await updateShow(fresh.deps.db, fresh.actors.owner, {
      showId: fresh.show.id,
      patch: { title: 'A/B: "Show"' },
    })
    const { record } = await exportCueList(fresh.deps.db, fresh.deps.blobs, fresh.actors.owner, {
      departmentId: fresh.depts.SND.id,
      format: 'csv',
    })
    expect(record.filename).toBe('A-B- -Show- - SND cue sheet.csv')
    const csv = utf8(
      new Uint8Array((await readBlobBytes(fresh.deps.blobs, record.fileKey)) as Buffer),
    )
    expect(csv).toBe(`${BOM}Cue,Type,Label,Page,Document,Trigger,Notes,Status\r\n`)
  })
})

describe('uploading cue sheets', () => {
  const metaOf = (kind: string, over: Record<string, unknown> = {}) => ({
    id: newId(),
    kind,
    filename: `LX.${kind === 'xlsx' ? 'xlsx' : kind === 'csv' ? 'csv' : 'pdf'}`,
    layerSelection: [{ kind: 'department', id: s.depts.LX.id }],
    ...over,
  })
  const post = async (m: Record<string, unknown>, bytes: Uint8Array) =>
    asJson(
      await s.app.request(`/api/shows/${s.show.id}/exports`, {
        method: 'POST',
        headers: { cookie: s.viewer.cookie, origin: APP_ORIGIN },
        body: multipart({ meta: JSON.stringify(m) }, { bytes }),
      }),
    )
  const text = (t: string) => new TextEncoder().encode(t)
  const stored = async (id: string) =>
    (await blobFiles(s.deps)).filter((f) => f.includes(`/exports/${id}/`))

  test('a csv upload takes any bytes, an xlsx upload needs PK, a pdf-sheet upload needs %PDF-', async () => {
    const csvMeta = metaOf('csv')
    const csv = await post(csvMeta, text(`${BOM}Cue,Type\r\n10,go\r\n`))
    expect(csv.status).toBe(201)
    expect(await csv.json()).toMatchObject({ kind: 'csv', filename: 'LX.csv' })

    const xlsxMeta = metaOf('xlsx')
    const xlsx = await post(xlsxMeta, text('PK\u0003\u0004rest'))
    expect(xlsx.status).toBe(201)
    expect((await xlsx.json()).kind).toBe('xlsx')
  })

  test('a file of the wrong type for its kind is 400 and nothing is stored', async () => {
    const cases: Array<[string, Uint8Array]> = [
      ['xlsx', text('a,b\n1,2\n')],
      ['xlsx', text('%PDF-1.7')],
      ['pdf-sheet', text('PK\u0003\u0004')],
      ['pdf-sheet', text('a,b\n1,2\n')],
      ['pdf-script', text('PK\u0003\u0004')],
    ]
    for (const [kind, bytes] of cases) {
      const m = metaOf(kind)
      const res = await post(m, bytes)
      expect([kind, res.status]).toEqual([kind, 400])
      expect(await stored(m.id)).toEqual([])
      expect(
        await s.deps.db.select().from(exportRecords).where(eq(exportRecords.id, m.id)),
      ).toEqual([])
    }
  })

  test('the error names what was expected', async () => {
    const res = await post(metaOf('xlsx'), text('plain'))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/XLSX/)
  })

  test('bad meta is still 400 when the kind cannot be read', async () => {
    const res = await asJson(
      await s.app.request(`/api/shows/${s.show.id}/exports`, {
        method: 'POST',
        headers: { cookie: s.viewer.cookie, origin: APP_ORIGIN },
        body: multipart({ meta: '{"kind":"nope"}' }, { bytes: text('x') }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
