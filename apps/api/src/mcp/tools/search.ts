import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { searchVersion } from '../../services'
import { MAX_SEARCH_LIMIT } from '../../services/search'
import type { McpContext } from '../context'
import { guarded, jsonResult } from '../results'

export function registerSearchTools(server: McpServer, mcp: McpContext): void {
  const { db, blobs } = mcp.deps

  server.registerTool(
    'search_script',
    {
      title: 'Search script',
      description:
        'Finds a word or phrase in a document version, ignoring case and punctuation, in page ' +
        'then reading order. Each hit has the zero-based pageIndex, a snippet of the line, the ' +
        "word indices it spans in that page's word layer (as get_page returns it), and box, the " +
        "first word's box in PDF points (origin bottom left). Default 50 hits, at most 200.",
      inputSchema: z.object({
        versionId: z.string().min(1).describe('The document version id.'),
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    guarded(async (args, ctx) => {
      const hits = await searchVersion(db, blobs, mcp.actor(ctx), args)
      return jsonResult({ hits })
    }),
  )
}
