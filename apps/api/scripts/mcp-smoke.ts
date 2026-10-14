/**
 * Smoke test for a running Binder API's MCP endpoint, with a real SDK client over HTTP.
 *
 *   BINDER_TOKEN=bnd_... [BINDER_MCP_URL=http://localhost:3000/mcp] node apps/api/scripts/mcp-smoke.ts
 *
 * Lists the tools, lists shows, reads page 1 (index 0) of the first ready document it finds, and
 * searches that version for a word from the page. Prints a summary; exits non-zero on any failure.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const token = process.env.BINDER_TOKEN
const url = new URL(process.env.BINDER_MCP_URL ?? 'http://localhost:3000/mcp')
if (!token) {
  console.error('Set BINDER_TOKEN to a personal access token (bnd_...).')
  process.exit(1)
}

// biome-ignore lint/suspicious/noExplicitAny: a smoke script reads loosely typed tool results
type Json = any

const client = new Client({ name: 'binder-mcp-smoke', version: '0.0.0' })
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
})

async function call(name: string, args: Record<string, unknown>): Promise<Json> {
  const result = (await client.callTool({ name, arguments: args })) as Json
  if (result.isError) throw new Error(`${name} failed: ${result.content?.[0]?.text}`)
  return result
}

try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`)

  const { resources } = await client.listResources()
  console.log(`resources: ${resources.map((r) => r.uri).join(', ')}`)

  const shows = (await call('list_shows', {})).structuredContent
  console.log(
    `shows: ${shows.active.length} active, ${shows.archived.length} archived: ` +
      shows.active.map((s: Json) => `${s.title} (${s.role})`).join(', '),
  )

  let target: { show: Json; doc: Json } | null = null
  for (const show of [...shows.active, ...shows.archived]) {
    const { documents } = (await call('list_documents', { showId: show.id })).structuredContent
    const doc = documents.find((d: Json) =>
      d.versions.some((v: Json) => v.id === d.currentVersionId && v.status === 'ready'),
    )
    if (doc) {
      target = { show, doc }
      break
    }
  }
  if (!target) throw new Error('no show has a ready document; upload one and wait for processing')
  const { show, doc } = target
  console.log(`document: "${doc.title}" (${doc.kind}) in "${show.title}"`)

  const page = await call('get_page', { versionId: doc.currentVersionId, index: 0 })
  const image = page.content.find((c: Json) => c.type === 'image')
  const pageData = page.structuredContent
  const firstLines = pageData.text.split('\n').slice(0, 3).join(' / ')
  console.log(
    `page 1: ${pageData.width} x ${pageData.height} pt, ${pageData.words.length} words, ` +
      `image ${image.mimeType} ${pageData.image.width} x ${pageData.image.height} px ` +
      `(${Math.round((image.data.length * 3) / 4 / 1024)} KB), ` +
      `text block ${page.content[0].text.length} chars`,
  )
  console.log(`page 1 starts: ${firstLines}`)

  const word =
    process.env.BINDER_SMOKE_QUERY ??
    pageData.words.map((w: Json) => w[0]).find((t: string) => /^[A-Za-z]{5,}$/.test(t))
  const { hits } = (
    await call('search_script', { versionId: doc.currentVersionId, query: word, limit: 5 })
  ).structuredContent
  console.log(`search "${word}": ${hits.length} hit(s)`)
  for (const hit of hits) console.log(`  page ${hit.pageIndex + 1}: ${hit.snippet}`)
} finally {
  await client.close()
}
