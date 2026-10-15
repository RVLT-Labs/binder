/**
 * Milestone 1 smoke test against a running Binder: MCP over HTTP (client name `m1-smoke`) and REST,
 * both with a bearer personal access token. Prints PASS or FAIL per step and exits non-zero on any
 * failure.
 *
 *   BINDER_URL=<origin> BINDER_TOKEN=<token> \
 *     pnpm --filter @binder/api exec tsx ../../deploy/scripts/m1-smoke.ts --stage checkpoint
 *
 * BINDER_TOKEN is a `*`-scoped personal access token (Settings > Tokens). It is read from the
 * environment only: never written to a file and never printed. The script creates one show named
 * "M1 smoke <ISO time>" and archives it at the end, so a run leaves a read-only trace.
 *
 * Stages: `checkpoint` is the Task 10 steps; `full` runs the checkpoint steps and then history and
 * revert, exports, a revision upload with re-anchoring, and the presence upgrade guard, all on the
 * same smoke show, which is archived last (and on any failure).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ensureFixtures, FIXTURES } from '../../fixtures/scripts/index.ts'

const SEEDED_DEPARTMENTS = ['LX', 'SND', 'TM', 'VID', 'SM', 'STG', 'FLY']
const READY_TIMEOUT_MS = 5 * 60_000
const POLL_MS = 2_000
/** The page whose text the placement quote is taken from (zero-based). */
const QUOTE_PAGE_INDEX = 3

// ---- The MCP client -----------------------------------------------------------------------------
// This file lives outside the workspace packages, so the SDK is resolved from apps/api, which has
// it as a dev dependency, rather than from here.

interface ToolResult {
  isError?: boolean
  content: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
}
interface McpClient {
  connect(transport: unknown): Promise<void>
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

async function loadMcpSdk(): Promise<{
  Client: new (info: { name: string; version: string }) => McpClient
  StreamableHTTPClientTransport: new (url: URL, opts: { requestInit: RequestInit }) => unknown
}> {
  const fromApi = createRequire(new URL('../../apps/api/package.json', import.meta.url))
  return import(pathToFileURL(fromApi.resolve('@modelcontextprotocol/client')).href)
}

// ---- Steps --------------------------------------------------------------------------------------

type Json = Record<string, unknown>

export interface State {
  base: string
  token: string
  mcp: McpClient
  showId?: string
  departmentIds?: Record<string, string>
  documentId?: string
  versionId?: string
  quote?: string
  cueId?: string
  /** The change log seq of the cue's relabel, from the history step. */
  relabelSeq?: number
  /** The version uploaded by the revision step. */
  secondVersionId?: string
  /** Steps that have run, passed or failed (the connect step included). */
  ran?: number
  /** Set once the archive step has passed (or the cleanup has archived the show). */
  archived?: boolean
}

const text = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('\n')

async function tool(s: State, name: string, args: Record<string, unknown>): Promise<Json> {
  const result = (await s.mcp.callTool({ name, arguments: args })) as ToolResult
  if (result.isError) throw new Error(`${name} failed: ${text(result).slice(0, 300)}`)
  return (result.structuredContent ?? {}) as Json
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`no ${what} from an earlier step`)
  return value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface Step {
  name: string
  run(s: State): Promise<string | undefined>
}

/** The checkpoint steps up to, not including, the archive step, which always runs last. */
const CHECKPOINT_WORK: Step[] = [
  {
    name: 'create_show',
    async run(s) {
      const title = `M1 smoke ${new Date().toISOString()}`
      const show = await tool(s, 'create_show', { title })
      s.showId = String(show.id)
      if (show.title !== title)
        throw new Error(`show came back titled ${JSON.stringify(show.title)}`)
      return s.showId
    },
  },
  {
    name: 'list_departments returns the seven seeded codes',
    async run(s) {
      const out = await tool(s, 'list_departments', { showId: need(s.showId, 'show') })
      const list = out.departments as Array<{ id: string; code: string }>
      const codes = list.map((d) => d.code).sort()
      const want = [...SEEDED_DEPARTMENTS].sort()
      if (JSON.stringify(codes) !== JSON.stringify(want)) {
        throw new Error(`got ${codes.join(',')}, wanted ${want.join(',')}`)
      }
      s.departmentIds = Object.fromEntries(list.map((d) => [d.code, d.id]))
      return codes.join(' ')
    },
  },
  {
    name: 'upload the libretto (POST /api/shows/:id/documents)',
    async run(s) {
      await ensureFixtures()
      const form = new FormData()
      form.append('kind', 'libretto')
      form.append('title', 'Smoke libretto')
      // The server reads the text fields before the file, so the file part goes last.
      form.append(
        'file',
        new Blob([await readFile(FIXTURES.librettoPdf)], { type: 'application/pdf' }),
        basename(FIXTURES.librettoPdf),
      )
      const res = await fetch(`${s.base}/api/shows/${need(s.showId, 'show')}/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${s.token}` },
        body: form,
      })
      if (res.status !== 201) {
        throw new Error(`upload answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      const created = (await res.json()) as { document: { id: string }; version: { id: string } }
      s.documentId = created.document.id
      s.versionId = created.version.id
      return `document ${s.documentId}`
    },
  },
  {
    name: 'list_documents until the version is ready',
    async run(s) {
      const showId = need(s.showId, 'show')
      const versionId = need(s.versionId, 'version')
      const started = Date.now()
      for (;;) {
        const out = await tool(s, 'list_documents', { showId })
        const versions = (out.documents as Array<{ versions: Array<Json> }>).flatMap(
          (d) => d.versions,
        )
        const version = versions.find((v) => v.id === versionId)
        if (!version) throw new Error('the uploaded version is not listed')
        if (version.status === 'ready') {
          return `${version.pageCount} pages in ${Math.round((Date.now() - started) / 1000)}s`
        }
        if (version.status === 'failed') throw new Error(`processing failed: ${version.error}`)
        if (Date.now() - started > READY_TIMEOUT_MS) {
          throw new Error(`still ${version.status} after ${READY_TIMEOUT_MS / 60_000} minutes`)
        }
        await sleep(POLL_MS)
      }
    },
  },
  {
    name: `place_cue_at_text with a quote from page index ${QUOTE_PAGE_INDEX}`,
    async run(s) {
      const page = await tool(s, 'get_page', {
        versionId: need(s.versionId, 'version'),
        index: QUOTE_PAGE_INDEX,
        includeImage: false,
      })
      const words = page.words as Array<[string, ...number[]]>
      const lines = page.lines as number[][]
      const line = lines.find((l) => l.length >= 6)
      if (!line) throw new Error(`page ${QUOTE_PAGE_INDEX} has no line of six words`)
      s.quote = line
        .slice(0, 8)
        .map((i) => words[i]?.[0])
        .join(' ')
      const placed = await tool(s, 'place_cue_at_text', {
        showId: need(s.showId, 'show'),
        department: 'LX',
        documentId: need(s.documentId, 'document'),
        quote: s.quote,
        nearPageIndex: QUOTE_PAGE_INDEX,
        label: 'smoke cue',
      })
      if (placed.status !== 'placed') {
        throw new Error(`answered ${JSON.stringify(placed.status)} for "${s.quote}"`)
      }
      s.cueId = String((placed.cue as Json).id)
      return `cue ${s.cueId} at "${s.quote}"`
    },
  },
  {
    name: 'update_cue relabels it',
    async run(s) {
      const cue = await tool(s, 'update_cue', {
        cueId: need(s.cueId, 'cue'),
        label: 'smoke relabelled',
      })
      if (cue.label !== 'smoke relabelled') throw new Error(`label is ${JSON.stringify(cue.label)}`)
      return undefined
    },
  },
  {
    name: 'create_annotation adds an LX rect',
    async run(s) {
      const a = await tool(s, 'create_annotation', {
        showId: need(s.showId, 'show'),
        layer: 'LX',
        type: 'rect',
        anchor: {
          documentId: need(s.documentId, 'document'),
          pageIndex: QUOTE_PAGE_INDEX,
          x: 100,
          y: 500,
        },
        geometry: { w: 80, h: 30 },
      })
      if (a.type !== 'rect') throw new Error(`created a ${JSON.stringify(a.type)}`)
      return `annotation ${String(a.id)}`
    },
  },
  {
    name: 'renumber_cues answers',
    async run(s) {
      const out = await tool(s, 'renumber_cues', {
        showId: need(s.showId, 'show'),
        department: 'LX',
        documentId: need(s.documentId, 'document'),
      })
      if (typeof out.changed !== 'number' || !Array.isArray(out.flagged)) {
        throw new Error(`unexpected answer ${JSON.stringify(out)}`)
      }
      return `changed ${out.changed}, flagged ${out.flagged.length}`
    },
  },
]

const ARCHIVE: Step = {
  name: 'update_show archives the smoke show',
  async run(s) {
    const show = await tool(s, 'update_show', {
      showId: need(s.showId, 'show'),
      status: 'archived',
    })
    if (show.status !== 'archived') throw new Error(`status is ${JSON.stringify(show.status)}`)
    s.archived = true
    return undefined
  },
}

/** The Task 10 steps. */
export const CHECKPOINT: Step[] = [...CHECKPOINT_WORK, ARCHIVE]

// ---- The full stage -----------------------------------------------------------------------------

const AGENT_PREFIX = 'm1-smoke/'
const CHECKPOINT_LABEL = 'smoke cue'
const RELABELLED = 'smoke relabelled'

/** GET a path from the app with the bearer token and return the bytes. */
async function getBytes(s: State, path: string): Promise<Buffer> {
  const res = await fetch(`${s.base}${path}`, { headers: { authorization: `Bearer ${s.token}` } })
  if (res.status !== 200) throw new Error(`GET ${path} answered ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** An export record's file, read through the same /blobs route the app uses. */
const exportFile = (s: State, record: Json) =>
  getBytes(s, `/blobs/${String(record.fileKey).split('/').map(encodeURIComponent).join('/')}`)

const startsWith = (bytes: Buffer, prefix: number[] | string): boolean => {
  const want = typeof prefix === 'string' ? Buffer.from(prefix, 'latin1') : Buffer.from(prefix)
  return bytes.subarray(0, want.length).equals(want)
}

/**
 * The status a WebSocket upgrade request is answered with, sent as a plain HTTP request so the
 * `Origin` can be chosen (Node's own WebSocket client cannot set it). 101 means the socket opened.
 * No credentials are sent: this asks what the proxy and the guards do for a stranger.
 */
export function upgradeStatus(url: string, origin: string): Promise<number> {
  const target = new URL(url)
  const request = target.protocol === 'https:' ? https.request : http.request
  return new Promise((resolveStatus, reject) => {
    const req = request(target, {
      method: 'GET',
      timeout: 20_000,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        Origin: origin,
      },
    })
    req.on('response', (res) => {
      res.resume()
      resolveStatus(res.statusCode ?? 0)
    })
    req.on('upgrade', (_res, socket) => {
      socket.destroy()
      resolveStatus(101)
    })
    req.on('timeout', () => req.destroy(new Error('no answer within 20 s')))
    req.on('error', reject)
    req.end()
  })
}

/** Task 23: history and revert, exports, a revision with re-anchoring, and the presence guard. */
export const FULL: Step[] = [
  {
    name: 'get_history shows the cue insert and relabel via mcp as m1-smoke',
    async run(s) {
      const out = await tool(s, 'get_history', {
        showId: need(s.showId, 'show'),
        rowId: need(s.cueId, 'cue'),
        table: 'cues',
      })
      const entries = out.entries as Array<{
        seq: number
        op: string
        via: string
        agent: string | null
        after: Json | null
      }>
      const mine = entries.filter((e) => e.via === 'mcp' && e.agent?.startsWith(AGENT_PREFIX))
      if (!mine.some((e) => e.op === 'insert')) throw new Error('no mcp insert for the cue')
      const relabel = mine.find((e) => e.op === 'update' && e.after?.label === RELABELLED)
      if (!relabel) throw new Error('no mcp relabel for the cue')
      s.relabelSeq = relabel.seq
      return `${entries.length} entries, relabel seq ${relabel.seq}, agent ${relabel.agent}`
    },
  },
  {
    name: 'revert_change restores the label',
    async run(s) {
      await tool(s, 'revert_change', { seq: need(s.relabelSeq, 'relabel seq') })
      const cue = await tool(s, 'get_cue', { cueId: need(s.cueId, 'cue') })
      if (cue.label !== CHECKPOINT_LABEL) {
        throw new Error(`label is ${JSON.stringify(cue.label)}, wanted ${CHECKPOINT_LABEL}`)
      }
      return undefined
    },
  },
  {
    name: 'get_activity lists the batch as "<name> via m1-smoke"',
    async run(s) {
      const out = await tool(s, 'get_activity', { showId: need(s.showId, 'show') })
      const groups = out.groups as Array<{ label: string; summary: string }>
      const mine = groups.find((g) => /^.+ via m1-smoke$/.test(g.label))
      if (!mine) {
        throw new Error(`no group labelled "<name> via m1-smoke" in ${groups.length} groups`)
      }
      return `"${mine.label}": ${mine.summary}`
    },
  },
  {
    name: 'export_marked_script (all layers) returns a PDF',
    async run(s) {
      const out = await tool(s, 'export_marked_script', {
        documentId: need(s.documentId, 'document'),
        layers: 'all',
      })
      const record = out.record as Json
      const bytes = await exportFile(s, record)
      if (!startsWith(bytes, '%PDF-')) throw new Error('the file does not start with %PDF-')
      const listed = await tool(s, 'list_exports', { showId: need(s.showId, 'show') })
      const ids = (listed.items as Array<{ id: string }> | undefined)?.map((r) => r.id) ?? []
      if (!ids.includes(String(record.id))) throw new Error('list_exports does not list the record')
      return `${bytes.length} bytes, record ${String(record.id)}`
    },
  },
  {
    name: 'export_cue_list csv starts with the byte order mark',
    async run(s) {
      const out = await tool(s, 'export_cue_list', {
        showId: need(s.showId, 'show'),
        department: 'LX',
        format: 'csv',
      })
      const bytes = await exportFile(s, out.record as Json)
      if (!startsWith(bytes, [0xef, 0xbb, 0xbf])) throw new Error('no UTF-8 byte order mark')
      return `${bytes.length} bytes`
    },
  },
  {
    name: 'export_cue_list xlsx starts with PK',
    async run(s) {
      const out = await tool(s, 'export_cue_list', {
        showId: need(s.showId, 'show'),
        department: 'LX',
        format: 'xlsx',
      })
      const bytes = await exportFile(s, out.record as Json)
      if (!startsWith(bytes, 'PK')) throw new Error('not a zip container')
      return `${bytes.length} bytes`
    },
  },
  {
    name: 'upload a revision (POST /api/shows/:id/documents/:docId/versions)',
    async run(s) {
      await ensureFixtures()
      const form = new FormData()
      form.append('label', 'Smoke revision')
      form.append(
        'file',
        new Blob([await readFile(FIXTURES.revisedCutPdf)], { type: 'application/pdf' }),
        basename(FIXTURES.revisedCutPdf),
      )
      const url = `${s.base}/api/shows/${need(s.showId, 'show')}/documents/${need(s.documentId, 'document')}/versions`
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${s.token}` },
        body: form,
      })
      if (res.status !== 201) {
        throw new Error(`upload answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      s.secondVersionId = ((await res.json()) as { version: { id: string } }).version.id
      return `version ${s.secondVersionId}`
    },
  },
  {
    name: 'the revision reaches ready and becomes current',
    async run(s) {
      const documentId = need(s.documentId, 'document')
      const versionId = need(s.secondVersionId, 'second version')
      const started = Date.now()
      for (;;) {
        const out = await tool(s, 'get_document', { documentId })
        const doc = out.document as { currentVersionId: string | null }
        const version = (out.versions as Array<Json>).find((v) => v.id === versionId)
        if (!version) throw new Error('the uploaded revision is not listed')
        if (version.status === 'failed') throw new Error(`processing failed: ${version.error}`)
        if (version.status === 'ready' && doc.currentVersionId === versionId) {
          return `${version.pageCount} pages in ${Math.round((Date.now() - started) / 1000)}s`
        }
        if (Date.now() - started > READY_TIMEOUT_MS) {
          throw new Error(
            `status ${version.status}, current ${doc.currentVersionId === versionId ? 'yes' : 'no'} after ${READY_TIMEOUT_MS / 60_000} minutes`,
          )
        }
        await sleep(POLL_MS)
      }
    },
  },
  {
    name: 'get_reanchor_review answers for the new version',
    async run(s) {
      const out = await tool(s, 'get_reanchor_review', {
        documentId: need(s.documentId, 'document'),
      })
      if (out.currentVersionId !== s.secondVersionId) {
        throw new Error(`review is for version ${String(out.currentVersionId)}`)
      }
      if (!Array.isArray(out.pending) || !Array.isArray(out.olderVersions)) {
        throw new Error(`unexpected answer ${JSON.stringify(out).slice(0, 200)}`)
      }
      return `${out.pending.length} pending, ${out.olderVersions.length} on older versions`
    },
  },
  {
    name: 'presence upgrade without a session is refused (401), and a foreign Origin too (403)',
    async run(s) {
      const url = `${s.base}/api/shows/${need(s.showId, 'show')}/presence`
      const own = await upgradeStatus(url, new URL(s.base).origin)
      if (own !== 401) throw new Error(`own origin answered ${own}, wanted 401`)
      const foreign = await upgradeStatus(url, 'https://evil.example')
      if (foreign !== 403) throw new Error(`foreign origin answered ${foreign}, wanted 403`)
      return `own origin ${own}, foreign origin ${foreign}`
    },
  },
]

/** The steps of a stage, in order. The archive step is always last, after the full stage's steps. */
export function stepsFor(stage: 'checkpoint' | 'full'): Step[] {
  return stage === 'full' ? [...CHECKPOINT_WORK, ...FULL, ARCHIVE] : CHECKPOINT
}

// ---- Runner -------------------------------------------------------------------------------------

type Log = (line: string) => void

/** Runs the steps in order; after the first failure the rest print SKIP. Resolves to true on failure. */
export async function runSteps(steps: Step[], s: State, log: Log = console.log): Promise<boolean> {
  let failed = false
  const total = steps.length + 1
  for (const [i, step] of steps.entries()) {
    const label = `[${i + 2}/${total}] ${step.name}`
    if (failed) {
      log(`SKIP ${label}`)
      continue
    }
    s.ran = (s.ran ?? 0) + 1
    try {
      const detail = await step.run(s)
      log(`PASS ${label}${detail ? ` (${detail})` : ''}`)
    } catch (err) {
      log(`FAIL ${label}: ${err instanceof Error ? err.message : err}`)
      failed = true
    }
  }
  return failed
}

/**
 * A failed run must not leave an active smoke show behind (production runs this too): when a show
 * was created and the archive step did not pass, archive it now. Best effort: it reports
 * CLEANUP PASS or CLEANUP FAIL and never changes the exit code.
 */
export async function cleanupShow(s: State, log: Log = console.log): Promise<void> {
  if (!s.showId || s.archived) return
  try {
    await tool(s, 'update_show', { showId: s.showId, status: 'archived' })
    s.archived = true
    log(`CLEANUP PASS archived the smoke show ${s.showId}`)
  } catch (err) {
    log(
      `CLEANUP FAIL could not archive the smoke show ${s.showId}; archive it by hand: ${err instanceof Error ? err.message : err}`,
    )
  }
}

/**
 * The exit code of a finished run. Zero needs every expected step to have run and none to have
 * failed, so a run that did nothing (an empty step list, a skipped `main`) can never pass.
 */
export function exitCodeFor(run: { failed: boolean; ran: number; expected: number }): 0 | 1 {
  return !run.failed && run.expected > 0 && run.ran === run.expected ? 0 : 1
}

/** Prints `line` with every occurrence of the secret removed, so no step message can leak it. */
export function redactor(secret: string): Log {
  return (line) => console.log(secret ? line.split(secret).join('[token]') : line)
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { stage: { type: 'string' } } })
  const stage = values.stage
  if (stage !== 'checkpoint' && stage !== 'full') {
    console.error(
      'Usage: m1-smoke.ts --stage checkpoint|full  (BINDER_URL and BINDER_TOKEN in the environment)',
    )
    return 2
  }
  const url = process.env.BINDER_URL
  const token = process.env.BINDER_TOKEN
  if (!url || !token) {
    console.error(
      'Set BINDER_URL (the origin) and BINDER_TOKEN (a "*"-scoped personal access token).',
    )
    return 2
  }
  const base = url.replace(/\/+$/, '')
  const log = redactor(token)

  const { Client, StreamableHTTPClientTransport } = await loadMcpSdk()
  const mcp = new Client({ name: 'm1-smoke', version: '1.0.0' })
  const steps = stepsFor(stage)
  const s: State = { base, token, mcp, ran: 0 }
  const total = steps.length + 1
  let failed = false

  try {
    try {
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: {
            headers: {
              authorization: `Bearer ${token}`,
              'x-request-id': randomUUID(),
              // Stateless MCP requests do not carry the client's name, so the API logs the
              // User-Agent as the change log's agent: this makes it `m1-smoke/1.0.0`, not `node`.
              'user-agent': `${AGENT_PREFIX}1.0.0`,
            },
          },
        }),
      )
      s.ran = 1
      log(`PASS [1/${total}] connect to ${base}/mcp as m1-smoke`)
      failed = await runSteps(steps, s, log)
    } catch (err) {
      s.ran = 1
      log(`FAIL [1/${total}] connect to ${base}/mcp: ${err instanceof Error ? err.message : err}`)
      failed = true
      for (const [i, step] of steps.entries()) log(`SKIP [${i + 2}/${total}] ${step.name}`)
    }
    await cleanupShow(s, log)
  } finally {
    await mcp.close().catch(() => {})
  }
  const code = exitCodeFor({ failed, ran: s.ran ?? 0, expected: total })
  log(
    code === 0
      ? `PASS (${stage}: ${s.ran}/${total} steps)`
      : `FAIL (${stage}: ${s.ran ?? 0}/${total} steps ran)`,
  )
  return code
}

/** `realpath` of a path, or the resolved path itself when it cannot be read (a missing file). */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Whether this module is the program being run. Symlinks are resolved on both sides, because a
 * symlinked path (a checkout reached through a link, a pnpm exec path) must not look like an
 * import and make the script exit 0 having tested nothing. `mismatch` is a run that asked for a
 * stage (`--stage` in the arguments) but whose entry path does not match this file: the caller must
 * fail loudly instead of silently doing nothing.
 */
export function entryMode(metaUrl: string, argv: readonly string[]): 'run' | 'import' | 'mismatch' {
  const entry = argv[1]
  if (!entry) return 'import'
  const self = realOrResolved(fileURLToPath(metaUrl))
  if (realOrResolved(entry) === self) return 'run'
  return argv.slice(2).some((a) => a === '--stage' || a.startsWith('--stage='))
    ? 'mismatch'
    : 'import'
}

const mode = entryMode(import.meta.url, process.argv)
if (mode === 'run') {
  process.exitCode = await main()
} else if (mode === 'mismatch') {
  console.error(
    `FAIL m1-smoke did not start: ${process.argv[1]} is not this script (${fileURLToPath(import.meta.url)}); no step ran`,
  )
  process.exitCode = 1
}
