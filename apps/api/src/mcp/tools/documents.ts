import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { getDocument, listDocuments, updateDocument, uploadDocumentFromUrl } from '../../services'
import type { Document, DocumentVersion, Page } from '../../services/documents'
import type { McpContext } from '../context'
import { guarded, jsonResult, pageArgs, paginate } from '../results'

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const kind = z.enum(['libretto', 'score', 'blocking', 'other'])
const ocrMode = z.enum(['auto', 'never'])

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }

const documentSummary = (d: Document) => ({
  id: d.id,
  showId: d.showId,
  title: d.title,
  kind: d.kind,
  currentVersionId: d.currentVersionId,
  sortOrder: d.sortOrder,
  ocrMode: d.ocrMode,
  snapToText: d.snapToText,
})

const versionSummary = (v: DocumentVersion) => ({
  id: v.id,
  versionNumber: v.versionNumber,
  label: v.label,
  status: v.status,
  pageCount: v.pageCount,
  uploadedAt: v.uploadedAt,
  error: v.error,
})

const pageSummary = (p: Page) => ({
  index: p.index,
  width: p.width,
  height: p.height,
  status: p.status,
  ocrApplied: p.ocrApplied,
})

export function registerDocumentTools(server: McpServer, mcp: McpContext): void {
  const { db, blobs, jobs } = mcp.deps

  server.registerTool(
    'list_documents',
    {
      title: 'List documents',
      description:
        "Lists a show's documents (libretto, score, blocking, other) in display order, each with " +
        'its versions and their processing status (queued, processing, ready, failed). A version ' +
        'id is what get_page and search_script take; currentVersionId is the one in use. Paginated.',
      inputSchema: z.object({ showId: id('show'), ...pageArgs }),
      annotations: READ,
    },
    guarded(async ({ showId, ...paging }, ctx) => {
      const docs = await listDocuments(db, mcp.actor(ctx), { showId })
      const page = paginate(
        docs.map((d) => ({ ...documentSummary(d), versions: d.versions.map(versionSummary) })),
        paging,
      )
      return jsonResult({ documents: page.items, nextCursor: page.nextCursor })
    }),
  )

  server.registerTool(
    'get_document',
    {
      title: 'Get document',
      description:
        'Returns a document, all its versions, and one version with a summary of every page ' +
        '(zero-based index, width and height in PDF points, status). The version is versionId ' +
        'when given, else the current version. Use it to learn the page count before get_page.',
      inputSchema: z.object({ documentId: id('document'), versionId: id('version').optional() }),
      annotations: READ,
    },
    guarded(async (args, ctx) => {
      const { document, versions, version } = await getDocument(db, mcp.actor(ctx), args)
      return jsonResult({
        document: documentSummary(document),
        versions: versions.map(versionSummary),
        version: version && { ...versionSummary(version), pages: version.pages.map(pageSummary) },
      })
    }),
  )

  server.registerTool(
    'update_document',
    {
      title: 'Update document',
      description:
        "Changes a document's title, kind, OCR mode (auto or never, used for future uploads), " +
        'snapToText (null for the kind default) or sortOrder. Editors and owners. Returns the document.',
      inputSchema: z.object({
        documentId: id('document'),
        title: z.string().trim().min(1).max(200).optional(),
        kind: kind.optional(),
        ocrMode: ocrMode.optional(),
        snapToText: z.boolean().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    guarded(async ({ documentId, ...patch }, ctx) =>
      jsonResult(documentSummary(await updateDocument(db, mcp.actor(ctx), { documentId, patch }))),
    ),
  )

  server.registerTool(
    'upload_document',
    {
      title: 'Upload document from URL',
      description:
        'Has the server download a PDF from a public http(s) URL (up to 200 MB, 60 s) and add it ' +
        'to a show: as a new document (kind required; title defaults to the file name), or with ' +
        'documentId as the next version of that document (optional label). Editors and owners. ' +
        'Processing (OCR, word layers) then runs in the background: poll get_document until the ' +
        'version is ready. Private and local addresses are refused. For a file on your own ' +
        'machine, upload it directly instead: curl -F kind=libretto -F title=Script ' +
        '-F file=@script.pdf -H "Authorization: Bearer $TOKEN" $API/api/shows/$SHOW/documents',
      inputSchema: z.object({
        showId: id('show'),
        url: z.string().min(1).describe('Public http(s) URL of the PDF.'),
        documentId: id('document').optional().describe('Add a new version to this document.'),
        kind: kind.optional(),
        title: z.string().trim().min(1).max(200).optional(),
        label: z.string().trim().min(1).max(200).optional().describe('Label for a new version.'),
        ocrMode: ocrMode.optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guarded(async (args, ctx) => {
      const { document, version } = await uploadDocumentFromUrl(
        db,
        blobs,
        jobs,
        mcp.actor(ctx),
        args,
      )
      return jsonResult({ document: documentSummary(document), version: versionSummary(version) })
    }),
  )
}
