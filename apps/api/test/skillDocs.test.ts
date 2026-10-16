import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { TOOL_NAMES } from '../src/mcp/registry'
import { createMcpServerFactory } from '../src/mcp/server'

/**
 * The drift guard for the Binder agent skill (`skills/binder/`): the docs name only tools that
 * exist, name every tool and resource template the server registers, and mark the confirm-gated
 * tools the way the code gates them. Registration never touches the database, so the server is
 * built on stub deps and listed over an in-memory client.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(HERE, '..', '..', '..', 'skills', 'binder')
const TOOLS_SRC_DIR = join(HERE, '..', 'src', 'mcp', 'tools')

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

const files = markdownFiles(SKILL_DIR)
const docs = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
const skill = docs.get(join(SKILL_DIR, 'SKILL.md')) ?? ''
const toolsDoc = docs.get(join(SKILL_DIR, 'references', 'tools.md')) ?? ''

/** The verbs registered tools start with: a backticked `<verb>_<words>` in the docs must be a tool. */
const VERBS = new Set(TOOL_NAMES.map((name) => name.split('_')[0]))

/**
 * The tools whose handler can answer CONFIRMATION_REQUIRED, read from the tool sources: each
 * `server.registerTool('<name>', …)` block up to the next registration, looking for the one
 * helper every gate calls.
 */
function gatedToolsInSource(): Set<string> {
  const gated = new Set<string>()
  for (const file of readdirSync(TOOLS_SRC_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(TOOLS_SRC_DIR, file), 'utf8')
    const blocks = source.split(/server\.registerTool\(\s*'/).slice(1)
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf("'"))
      if (block.includes('confirmationRequired(')) gated.add(name)
    }
  }
  return gated
}

/** The tool sections of tools.md: `### \`name\`` up to the next `###` or `##` heading. */
function toolSections(): Map<string, string> {
  const sections = new Map<string, string>()
  const parts = toolsDoc.split(/^(?=##)/m)
  for (const part of parts) {
    const heading = /^### `([a-z_]+)`/.exec(part)
    if (heading) sections.set(heading[1] as string, part)
  }
  return sections
}

let client: Client
let registeredTools: string[]
let registeredTemplates: string[]

beforeAll(async () => {
  const deps = { db: {}, blobs: {}, jobs: {}, presence: {} } as unknown as Parameters<
    typeof createMcpServerFactory
  >[0]
  const server = await createMcpServerFactory(deps)({
    era: 'legacy',
    authInfo: { token: 'test', clientId: 'test', scopes: ['shows:*'], extra: { userId: 'u' } },
    requestInfo: undefined,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'skill-docs-test', version: '1.0.0' })
  await client.connect(clientTransport)
  registeredTools = (await client.listTools()).tools.map((t) => t.name).sort()
  registeredTemplates = (await client.listResourceTemplates()).resourceTemplates.map(
    (t) => t.uriTemplate,
  )
})

afterAll(async () => {
  await client?.close()
})

test('the skill has its files', () => {
  expect(skill).not.toBe('')
  expect(toolsDoc).not.toBe('')
  expect(files.length).toBeGreaterThan(5)
})

test('the registry and the live server agree', () => {
  expect(registeredTools).toEqual([...TOOL_NAMES].sort())
  expect(registeredTemplates.length).toBeGreaterThan(0)
})

test('every tool name the docs use in backticks is a registered tool', () => {
  const known = new Set<string>(TOOL_NAMES)
  for (const [file, text] of docs) {
    for (const match of text.matchAll(/`([a-z]+(?:_[a-z]+)+)(?: \{[^`]*)?`/g)) {
      const name = match[1] as string
      if (!VERBS.has(name.split('_')[0] as string)) continue
      expect(known, `${file} names unknown tool \`${name}\``).toContain(name)
    }
  }
})

test('every tools/call example in the docs names a registered tool', () => {
  const known = new Set<string>(TOOL_NAMES)
  for (const [file, text] of docs) {
    for (const match of text.matchAll(/"name"\s*:\s*"([a-z_]+)"\s*,\s*"arguments"/g)) {
      expect(known, `${file} calls unknown tool "${match[1]}"`).toContain(match[1])
    }
  }
})

test('references/tools.md documents every registered tool', () => {
  for (const name of registeredTools) {
    expect(toolsDoc, `tools.md has no section for ${name}`).toMatch(
      new RegExp(`^### \`${name}\`$`, 'm'),
    )
  }
})

test('references/tools.md documents every registered resource template', () => {
  for (const template of registeredTemplates) {
    expect(toolsDoc, `tools.md does not mention ${template}`).toContain(`\`${template}\``)
  }
})

test('the tools marked confirm-gated in tools.md are exactly the ones the code gates', () => {
  const inCode = gatedToolsInSource()
  expect(inCode.size).toBeGreaterThan(0)
  const inDoc = new Set<string>()
  for (const [name, section] of toolSections()) {
    // "Not confirm-gated" marks an ungated tool that still deserves a question; anything else
    // that says confirm-gated is a gate.
    const marks = section.replace(/not confirm-gated/gi, '')
    if (/confirm-gated/i.test(marks)) inDoc.add(name)
  }
  expect([...inDoc].sort()).toEqual([...inCode].sort())
})

test('SKILL.md has the frontmatter the skill format needs', () => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skill)
  expect(match, 'SKILL.md starts with a frontmatter block').not.toBeNull()
  const frontmatter = match?.[1] ?? ''
  const field = (key: string) => new RegExp(`^${key}: (.+)$`, 'm').exec(frontmatter)?.[1]?.trim()
  expect(field('name')).toBe('binder')
  expect(field('version')).toBe('1.0.0')
  expect(field('author')).toBe('Jayden Nawotka')
  expect(field('license')).toBe('MIT')
  expect(field('description') ?? '').toMatch(/cues/)
})

test('every relative link in the skill points at a file', () => {
  for (const [file, text] of docs) {
    for (const match of text.matchAll(/\]\((?!https?:)([^)#]+)(#[^)]*)?\)/g)) {
      const target = join(dirname(file), match[1] as string)
      expect(docs.has(target), `${file} links to missing ${match[1]}`).toBe(true)
    }
  }
})
