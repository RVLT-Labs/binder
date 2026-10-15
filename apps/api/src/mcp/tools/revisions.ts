import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  compareDocumentVersions,
  listReanchorReview,
  listVersionAnchors,
  resolveReanchorItem,
} from '../../services'
import { COMPARE_DEFAULT_LIMIT, COMPARE_MAX_LIMIT } from '../../services/revisions'
import type { McpContext } from '../context'
import { guarded, jsonResult } from '../results'

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
// An ordinary logged write that restores or moves one anchor and can itself be reverted.
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)

export function registerRevisionTools(server: McpServer, mcp: McpContext): void {
  const { db, blobs } = mcp.deps

  server.registerTool(
    'get_reanchor_review',
    {
      title: 'Get the re-anchoring review',
      description:
        "Lists what a script revision left to review. `pending` holds the document's cues and " +
        'annotations whose anchor is on the current version but is approximate or unresolved; ' +
        '`olderVersions` holds those still anchored to another version (for example a cue placed ' +
        'offline after the switch). Each item has table (cues or annotations), rowId, layer, a ' +
        "title like 'LX 12 · Fly out', its anchor, and `previous`, the anchor before the latest " +
        "re-anchoring run moved it (null if none did). Another member's personal annotations are " +
        'never included. Resolve an item with resolve_reanchor_item.',
      inputSchema: z.object({ documentId: id('document') }),
      annotations: READ,
    },
    guarded(async (args, ctx) => jsonResult(await listReanchorReview(db, mcp.actor(ctx), args))),
  )

  server.registerTool(
    'resolve_reanchor_item',
    {
      title: 'Resolve a re-anchoring review item',
      description:
        'Resolves one review item (table and rowId from get_reanchor_review) as an ordinary logged ' +
        'edit that needs edit rights on its layer. "accept" keeps the anchor where it is and marks ' +
        'it ok (an unbound highlight stays unbound). "revert" puts back `previous`, the anchor on ' +
        'the older version, and is invalid when no re-anchoring run moved the item. "reanchor" ' +
        'matches the anchor from its version to the current one; an item already on the current ' +
        'version is left as it is. Returns the anchor afterwards.',
      inputSchema: z.object({
        table: z.enum(['cues', 'annotations']).describe('Which kind of row the item is.'),
        rowId: id('cue or annotation'),
        action: z.enum(['accept', 'revert', 'reanchor']),
      }),
      annotations: WRITE,
    },
    guarded(async (args, ctx) =>
      jsonResult({ anchor: await resolveReanchorItem(db, blobs, mcp.actor(ctx), args) }),
    ),
  )

  server.registerTool(
    'get_version_anchors',
    {
      title: 'Get anchors as they were on a version',
      description:
        'Returns every cue and annotation that was anchored to a document version, with the anchor ' +
        'it had there: its current anchor if that is on the version, otherwise the newest one in ' +
        'its change history that was. Use it to see where marks sat on an older version. Other ' +
        "members' personal annotations are never included.",
      inputSchema: z.object({ versionId: id('document version') }),
      annotations: READ,
    },
    guarded(async (args, ctx) =>
      jsonResult({ anchors: await listVersionAnchors(db, mcp.actor(ctx), args) }),
    ),
  )

  server.registerTool(
    'compare_versions',
    {
      title: 'Compare two versions of a document',
      description:
        'A line diff of two versions of one document, in reading order. Each entry is a line with ' +
        'op "same", "added" or "removed" and its text. `added` and `removed` count the whole diff; ' +
        `entries holds at most limit lines (default ${COMPARE_DEFAULT_LIMIT}, at most ` +
        `${COMPARE_MAX_LIMIT}) and truncated says whether it was cut.`,
      inputSchema: z.object({
        fromVersionId: id('older version'),
        toVersionId: id('newer version'),
        limit: z.number().int().min(1).max(COMPARE_MAX_LIMIT).optional(),
      }),
      annotations: READ,
    },
    guarded(async (args, ctx) =>
      jsonResult(await compareDocumentVersions(db, blobs, mcp.actor(ctx), args)),
    ),
  )
}
