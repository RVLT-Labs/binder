import {
  EXPORT_FILE_TYPES,
  type LayerRef,
  type PrintOptions,
  type StoredExportKind,
} from '@binder/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { invalid } from '../../errors'
import { exportCueList, exportMarkedScript, getDocument, listExportRecords } from '../../services'
import type { McpContext } from '../context'
import { guarded, jsonResult, pageArgs, paginate, toJson } from '../results'
import { resolveLayer } from './annotations'
import { resolveDepartment } from './cues'

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
  return Object.hasOwn(EXPORT_FILE_TYPES, kind)
    ? EXPORT_FILE_TYPES[kind as StoredExportKind].mime
    : 'application/pdf'
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
        "else's personal layer are never shown. A script PDF's record carries its print `options` " +
        '(pages, paper, includeStandbyWarn, includeAnnotations, includeCueNotes), null for other ' +
        'files and older records. Read a file as the binder://shows/{showId}/exports/{exportId} resource.',
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
        'and date. By default every page is printed at its own size and the searchable text layer ' +
        'is unchanged. `pages` prints only some pages (1-based: "1-5, 8"; a page past the end is ' +
        'an error), `paper` fits every page to A4 or Letter, and `includeStandbyWarn`, ' +
        '`includeAnnotations` and `includeCueNotes` (all on by default) leave those out. ' +
        'The file is named like songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf (show, document, ' +
        'version, layers) unless `filename` is given. Defaults to the ' +
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
        pages: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            'Pages to print: "all" (the default) or a list like "1-5, 8" or "3" (1-based; en dashes are fine).',
          ),
        paper: z
          .enum(['A4', 'Letter'])
          .optional()
          .describe(
            'Fit every page to this paper, centred. Omit to leave pages at their own size.',
          ),
        includeStandbyWarn: z
          .boolean()
          .optional()
          .describe('Print standby and warn cue tags as well as go tags. Default true.'),
        includeAnnotations: z
          .boolean()
          .optional()
          .describe('Print annotations (highlights, notes, shapes, stamps). Default true.'),
        includeCueNotes: z
          .boolean()
          .optional()
          .describe("Print each cue's note under its tag in the margin. Default true."),
        filename: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            'The file name, with or without .pdf (no / \\ : * ? " < > |). Omit for the default slug name.',
          ),
      }),
      annotations: CREATE,
    },
    guarded(async (args, ctx) => {
      const { documentId, versionId, layers, filename, ...print } = args
      const options: Partial<PrintOptions> = {}
      if (print.pages !== undefined) options.pages = print.pages
      if (print.paper !== undefined) options.paper = print.paper
      if (print.includeStandbyWarn !== undefined)
        options.includeStandbyWarn = print.includeStandbyWarn
      if (print.includeAnnotations !== undefined)
        options.includeAnnotations = print.includeAnnotations
      if (print.includeCueNotes !== undefined) options.includeCueNotes = print.includeCueNotes
      const actor = mcp.actor(ctx)
      const selection: 'all' | 'none' | LayerRef[] = Array.isArray(layers)
        ? await resolveLayers(actor, documentId, layers)
        : layers
      const { record, uri } = await exportMarkedScript(db, blobs, actor, {
        documentId,
        versionId,
        layers: selection,
        options,
        filename,
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

  server.registerTool(
    'export_cue_list',
    {
      title: 'Export a department cue list',
      description:
        "Makes a department's cue sheet as a PDF (laid out for the show's paper size, A4 or " +
        'Letter), an XLSX workbook or a CSV file, with columns Cue, Type, Label, Page, Document, ' +
        'Trigger, Notes and Status, in cue-number order with unplaced cues last. Name the ' +
        'department with `department` (a code like LX, or an id) together with `showId`, or give ' +
        'an id as `departmentId` alone. Records the export and returns the record and a resource_link to ' +
        'read the file (binder://shows/{showId}/exports/{exportId}).',
      inputSchema: z.object({
        department: z
          .string()
          .min(1)
          .optional()
          .describe(
            'The department code (like LX) or id, looked up in showId, which is required with it. With only an id, use departmentId.',
          ),
        departmentId: z.string().min(1).optional().describe('The department id.'),
        showId: z.string().min(1).optional().describe('The show id, to resolve a department code.'),
        format: z.enum(['pdf', 'xlsx', 'csv']).describe('The file to make.'),
      }),
      annotations: CREATE,
    },
    guarded(async ({ department, departmentId, showId, format }, ctx) => {
      const actor = mcp.actor(ctx)
      if ((department === undefined) === (departmentId === undefined)) {
        throw invalid('give either department or departmentId')
      }
      // With a showId the department is looked up in that show (so a code works, and an id from
      // another show is refused); an id alone is looked up on its own.
      const ref = (department ?? departmentId) as string
      let id = ref
      if (showId !== undefined) id = await resolveDepartment(db, actor, showId, ref)
      else if (department !== undefined) throw invalid('showId is required with a department code')
      const { record, uri } = await exportCueList(db, blobs, actor, { departmentId: id, format })
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
