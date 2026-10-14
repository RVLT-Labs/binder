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
 * Where `docs/guides/*.md` lives: next to the bundle (`dist/guides`, copied by tsup), or found by
 * walking up from this module to the repository's `docs/guides` in development and tests.
 */
function findGuidesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const bundled = join(here, 'guides')
  if (existsSync(bundled)) return bundled
  for (let dir = here; dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'docs', 'guides')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('docs/guides not found')
}

const GUIDES_DIR = findGuidesDir()
const SLUG = /^[a-z0-9-]+$/

async function guideSlugs(): Promise<string[]> {
  const files = await readdir(GUIDES_DIR)
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -'.md'.length))
    .filter((slug) => SLUG.test(slug))
    .sort()
}

/** The first `# ` heading, as the guide's title. */
const titleOf = (markdown: string, slug: string) =>
  /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? slug

/** The working guides (cue style, mic and DCA practice, the .tmix format) as `binder://guides/{slug}`. */
export function registerGuideResources(server: McpServer): void {
  server.registerResource(
    'guide',
    new ResourceTemplate('binder://guides/{slug}', {
      list: async () => ({
        resources: await Promise.all(
          (await guideSlugs()).map(async (slug) => ({
            uri: `binder://guides/${slug}`,
            name: slug,
            title: titleOf(await readFile(join(GUIDES_DIR, `${slug}.md`), 'utf8'), slug),
            mimeType: 'text/markdown',
          })),
        ),
      }),
    }),
    {
      title: 'Working guide',
      description:
        'House rules for marking up scripts: cue style, mic and DCA practice, and the verified ' +
        'TheatreMix .tmix format. Read the relevant guide before building cues or exports.',
      mimeType: 'text/markdown',
    },
    async (uri, vars) => {
      const slug = Array.isArray(vars.slug) ? vars.slug[0] : vars.slug
      if (!slug || !(await guideSlugs()).includes(slug)) {
        throw new ResourceNotFoundError(uri.href, 'No such guide')
      }
      const text = await readFile(join(GUIDES_DIR, `${slug}.md`), 'utf8')
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    },
  )
}
