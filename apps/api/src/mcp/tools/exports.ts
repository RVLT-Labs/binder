import type { LayerRef } from '@binder/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { exportMarkedScript, getDocument, listExportRecords } from '../../services'
import type { McpContext } from '../context'
import { guarded, jsonResult, pageArgs, paginate, toJson } from '../results'
import { resolveLayer } from './annotations'

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)

const LAYERS_DESCRIPTION =
  '"all" prints every visible department layer (no personal layer); "none" prints a clean copy; ' +
  'or a list of layers to print: a department code or id (like LX), "personal" for your own ' +
  'personal layer, or a layer key (department:<id> or personal:<your user id>). Including your ' +
  'personal layer makes the export private to you.'

/** The MIME type a resource link advertises for an export record's file. */
export function exportMimeType(kind: string): string {
  if (kind === 'csv') return 'text/csv'
  if (kind === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return 'application/pdf'
}

export function registerExportTools(server: McpServer, mcp: McpContext): void {
  const { db, blobs } = mcp.deps

  server.registerTool(
    'list_exports',
    {
      title: 'List exports',
      description:
        "Lists a show's export records, newest first: id, kind (pdf-script, pdf-sheet, csv, xlsx, " +
        'tmix), filename, the layer selection, who made it and when. Exports that include someone ' +
        "else's personal layer are never shown. Read a file as the binder://shows/{showId}/exports/{exportId} resource.",
      inputSchema: z.object({ showId: id('show'), ...pageArgs }),
      annotations: READ,
    },
    guarded(async ({ showId, ...page }, ctx) => {
      const all = await listExportRecords(db, mcp.actor(ctx), { showId })
      return jsonResult(paginate(all, page))
    }),
  )

  server.registerTool(
    'export_marked_script',
    {
      title: 'Export a marked-up script',
      description:
        "Makes a PDF of a document version with the chosen layers' cue markers, notes, shapes, " +
        'stamps and highlights printed on its pages, and a footer with the show, document, layers ' +
        'and date. Page size and the searchable text layer are unchanged. Defaults to the ' +
        "document's current version. Records the export and returns the record and a resource_link " +
        'to read the PDF (binder://shows/{showId}/exports/{exportId}).',
      inputSchema: z.object({
        documentId: id('document'),
        versionId: z
          .string()
          .min(1)
          .optional()
          .describe('The document version id; omit for the current version.'),
        layers: z
          .union([z.enum(['all', 'none']), z.array(z.string().min(1)).max(200)])
          .describe(LAYERS_DESCRIPTION),
      }),
      annotations: CREATE,
    },
    guarded(async ({ documentId, versionId, layers }, ctx) => {
      const actor = mcp.actor(ctx)
      const selection: 'all' | 'none' | LayerRef[] = Array.isArray(layers)
        ? await resolveLayers(actor, documentId, layers)
        : layers
      const { record, uri } = await exportMarkedScript(db, blobs, actor, {
        documentId,
        versionId,
        layers: selection,
      })
      const result = jsonResult({ record, uri })
      return {
        ...result,
        content: [
          ...result.content,
          {
            type: 'resource_link',
            uri,
            name: record.filename,
            mimeType: exportMimeType(record.kind),
          },
        ],
        structuredContent: toJson({ record, uri }),
      }
    }),
  )

  /** Layer names resolve against the document's show. */
  async function resolveLayers(
    actor: ReturnType<McpContext['actor']>,
    documentId: string,
    refs: string[],
  ): Promise<LayerRef[]> {
    const { document } = await getDocument(db, actor, { documentId })
    return Promise.all(refs.map((ref) => resolveLayer(db, actor, document.showId, ref)))
  }
}
