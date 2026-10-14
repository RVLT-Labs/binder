import { type McpServer, ResourceTemplate, type Variables } from '@modelcontextprotocol/server'
import { notFound } from '../../errors'
import { getPage, getPageImage } from '../../services'
import type { McpContext } from '../context'
import { resourceError } from '../results'
import { compactWords } from '../words'

const PAGE = 'binder://shows/{showId}/versions/{versionId}/pages/{index}'

function pageVars(vars: Variables): { showId: string; versionId: string; index: number } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const index = Number(one(vars.index))
  if (!Number.isInteger(index) || index < 0) throw notFound('Page not found')
  return { showId: one(vars.showId), versionId: one(vars.versionId), index }
}

/** Pages as `binder://` resources (spec 3.10) for clients that prefer reading to calling. */
export function registerPageResources(server: McpServer, mcp: McpContext): void {
  const { db, blobs } = mcp.deps

  server.registerResource(
    'page-words',
    new ResourceTemplate(`${PAGE}/words`, { list: undefined }),
    {
      title: 'Page word layer',
      description:
        "A page's words as JSON: text, words as [text, x, y, w, h] in PDF points, lines.",
      mimeType: 'application/json',
    },
    async (uri, vars, ctx) => {
      try {
        const { showId, versionId, index } = pageVars(vars)
        const { page, words } = await getPage(db, blobs, mcp.actor(ctx), { versionId, index })
        if (page.showId !== showId) throw notFound('Page not found')
        const body = {
          width: page.width,
          height: page.height,
          status: page.status,
          ...compactWords(words),
        }
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body) }],
        }
      } catch (err) {
        throw resourceError(err, uri.href)
      }
    },
  )

  server.registerResource(
    'page-image',
    new ResourceTemplate(`${PAGE}/image`, { list: undefined }),
    {
      title: 'Page image',
      description: 'The page rendered as a JPEG, at most 1600 px on the long side.',
      mimeType: 'image/jpeg',
    },
    async (uri, vars, ctx) => {
      try {
        const { showId, versionId, index } = pageVars(vars)
        const actor = mcp.actor(ctx)
        const { page } = await getPage(db, blobs, actor, { versionId, index })
        if (page.showId !== showId) throw notFound('Page not found')
        const { jpeg } = await getPageImage(db, blobs, actor, { versionId, index })
        const blob = Buffer.from(jpeg).toString('base64')
        return { contents: [{ uri: uri.href, mimeType: 'image/jpeg', blob }] }
      } catch (err) {
        throw resourceError(err, uri.href)
      }
    },
  )
}
