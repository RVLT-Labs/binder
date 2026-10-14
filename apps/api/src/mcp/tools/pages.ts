import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { getPage, getPageImage } from '../../services'
import { MAX_PAGE_IMAGE_PX } from '../../services/pages'
import type { McpContext } from '../context'
import { guarded, toJson } from '../results'
import { compactWords } from '../words'

export function registerPageTools(server: McpServer, mcp: McpContext): void {
  const { db, blobs } = mcp.deps

  server.registerTool(
    'get_page',
    {
      title: 'Get page',
      description:
        'Reads one page of a document version (index is zero-based) so you can both see and read ' +
        'it: a JPEG of the page (at most 1600 px on the long side; maxPx asks for smaller, ' +
        'includeImage false skips it) and its word layer. structuredContent has the page size ' +
        'in PDF points, text (the lines, joined), words as [text, x, y, w, h] boxes in PDF points ' +
        'with the origin at the bottom left, and lines as lists of word indices. A page that is ' +
        'not ready yet has no words; check status.',
      inputSchema: z.object({
        versionId: z.string().min(1).describe('The document version id.'),
        index: z.number().int().min(0).describe('Zero-based page index.'),
        includeImage: z.boolean().default(true),
        maxPx: z.number().int().min(100).max(MAX_PAGE_IMAGE_PX).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    guarded(async ({ versionId, index, includeImage, maxPx }, ctx) => {
      const actor = mcp.actor(ctx)
      const { page, words } = await getPage(db, blobs, actor, { versionId, index })
      const image = includeImage
        ? await getPageImage(db, blobs, actor, { versionId, index, maxPx })
        : null
      const compact = compactWords(words)
      const structured = toJson({
        versionId,
        index: page.index,
        width: page.width,
        height: page.height,
        rotation: page.rotation,
        status: page.status,
        ocrApplied: page.ocrApplied,
        image: image && { width: image.width, height: image.height },
        ...compact,
      })
      const header =
        `Page ${page.index} of version ${versionId}: ${page.width} x ${page.height} pt, ` +
        `status ${page.status}, ${words.words.length} words.`
      const content: CallToolResult['content'] = [
        { type: 'text', text: compact.text ? `${header}\n\n${compact.text}` : header },
      ]
      if (image) {
        content.push({
          type: 'image',
          data: Buffer.from(image.jpeg).toString('base64'),
          mimeType: 'image/jpeg',
        })
      }
      return { content, structuredContent: structured }
    }),
  )
}
