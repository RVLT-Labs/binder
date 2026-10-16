import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server'

/**
 * Where `skills/binder` lives: next to the bundle (`dist/skill`, copied by tsup), or found by
 * walking up from this module to the repository's `skills/binder` in development and tests.
 */
function findSkillDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const bundled = join(here, 'skill')
  if (existsSync(bundled)) return bundled
  for (let dir = here; dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'skills', 'binder')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('skills/binder not found')
}

const SKILL_DIR = findSkillDir()
const REFERENCES_DIR = join(SKILL_DIR, 'references')
const SLUG = /^[a-z0-9-]+$/
const INDEX = 'index'

/** The slugs the skill serves: `index` (SKILL.md) and each `references/<slug>.md`. */
async function skillSlugs(): Promise<string[]> {
  const files = await readdir(REFERENCES_DIR)
  const references = files
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -'.md'.length))
    .filter((slug) => SLUG.test(slug) && slug !== INDEX)
    .sort()
  return [INDEX, ...references]
}

const fileOf = (slug: string) =>
  slug === INDEX ? join(SKILL_DIR, 'SKILL.md') : join(REFERENCES_DIR, `${slug}.md`)

/** The first `# ` heading, as the file's title. */
const titleOf = (markdown: string, slug: string) =>
  /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? slug

/** `](references/x.md#a)`, `](x.md)`, `](../x.md)` or `](../SKILL.md)`: a link to another skill file. */
const SKILL_LINK = /\]\((?:\.\.\/|references\/)?(SKILL|[a-z0-9-]+)\.md(#[^)\s]*)?\)/g
const FENCE = /^ {0,3}(```|~~~)/

/**
 * Rewrites the skill's relative markdown links to the `binder://skill/{slug}` resources, so an
 * agent can follow them. Links to `SKILL.md` become `index`; anchors are kept. Absolute URLs,
 * other relative paths and anything inside a fenced code block are left as written.
 */
export function rewriteSkillLinks(markdown: string): string {
  let fence: string | undefined
  return markdown
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1]
      if (marker) {
        if (!fence) fence = marker
        else if (fence === marker) fence = undefined
        return line
      }
      if (fence) return line
      return line.replace(
        SKILL_LINK,
        (_match, name: string, anchor?: string) =>
          `](binder://skill/${name === 'SKILL' ? INDEX : name}${anchor ?? ''})`,
      )
    })
    .join('\n')
}

/** The agent skill (`skills/binder`) as `binder://skill/{slug}`: `index` is SKILL.md, the rest its references. */
export function registerSkillResources(server: McpServer): void {
  server.registerResource(
    'skill',
    new ResourceTemplate('binder://skill/{slug}', {
      list: async () => ({
        resources: await Promise.all(
          (await skillSlugs()).map(async (slug) => ({
            uri: `binder://skill/${slug}`,
            name: slug,
            title:
              slug === INDEX ? 'Binder skill' : titleOf(await readFile(fileOf(slug), 'utf8'), slug),
            mimeType: 'text/markdown',
          })),
        ),
      }),
    }),
    {
      title: 'Binder agent skill',
      description:
        'How to use Binder: placing cues, revisions, exports and safety. Start with ' +
        '`binder://skill/index`; its links point at the other files. Read it before marking up a script.',
      mimeType: 'text/markdown',
    },
    async (uri, vars) => {
      const slug = Array.isArray(vars.slug) ? vars.slug[0] : vars.slug
      if (!slug || !SLUG.test(slug) || !(await skillSlugs()).includes(slug)) {
        throw new ResourceNotFoundError(uri.href, 'No such skill file')
      }
      const text = rewriteSkillLinks(await readFile(fileOf(slug), 'utf8'))
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    },
  )
}
