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
 * Stages: `checkpoint` is the Task 10 steps; `full` runs those and then the steps Task 23 adds.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
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

interface State {
  base: string
  token: string
  mcp: McpClient
  showId?: string
  departmentIds?: Record<string, string>
  documentId?: string
  versionId?: string
  quote?: string
  cueId?: string
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

interface Step {
  name: string
  run(s: State): Promise<string | undefined>
}

const CHECKPOINT: Step[] = [
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
  {
    name: 'update_show archives the smoke show',
    async run(s) {
      const show = await tool(s, 'update_show', {
        showId: need(s.showId, 'show'),
        status: 'archived',
      })
      if (show.status !== 'archived') throw new Error(`status is ${JSON.stringify(show.status)}`)
      return undefined
    },
  },
]

/** Task 23 adds the steps that need a deployed stack (sync, exports, revisions). */
const FULL: Step[] = []

// ---- Runner -------------------------------------------------------------------------------------

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

  const { Client, StreamableHTTPClientTransport } = await loadMcpSdk()
  const mcp = new Client({ name: 'm1-smoke', version: '1.0.0' })
  const steps = stage === 'full' ? [...CHECKPOINT, ...FULL] : CHECKPOINT
  const s: State = { base, token, mcp }
  let failed = false
  const total = steps.length + 1

  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${token}`, 'x-request-id': randomUUID() },
        },
      }),
    )
    console.log(`PASS [1/${total}] connect to ${base}/mcp as m1-smoke`)
  } catch (err) {
    console.log(
      `FAIL [1/${total}] connect to ${base}/mcp: ${err instanceof Error ? err.message : err}`,
    )
    failed = true
  }

  for (const [i, step] of steps.entries()) {
    const label = `[${i + 2}/${total}] ${step.name}`
    if (failed) {
      console.log(`SKIP ${label}`)
      continue
    }
    try {
      const detail = await step.run(s)
      console.log(`PASS ${label}${detail ? ` (${detail})` : ''}`)
    } catch (err) {
      console.log(`FAIL ${label}: ${err instanceof Error ? err.message : err}`)
      failed = true
    }
  }
  await mcp.close().catch(() => {})
  console.log(failed ? 'FAIL' : `PASS (${stage})`)
  return failed ? 1 : 0
}

process.exitCode = await main()
