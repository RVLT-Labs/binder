import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { beginDocumentUpload, cancelDocumentUpload, completeDocumentUpload } from '../../services'
import {
  assertUploadTarget,
  MAX_OPEN_UPLOADS,
  MAX_PUT_ATTEMPTS,
  validateUploadIntent,
} from '../../services/documentUploads'
import { CONFIRM_DESCRIPTION, confirmationRequired } from '../confirm'
import type { McpContext } from '../context'
import { guarded, jsonResult } from '../results'
import { documentSummary, versionSummary } from './documents'

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const text = z.string().trim().min(1).max(200)

/** Single-quoted for a POSIX shell. */
const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

export function registerUploadTools(server: McpServer, mcp: McpContext): void {
  const { db, blobs, jobs, config } = mcp.deps

  server.registerTool(
    'begin_document_upload',
    {
      title: 'Begin a local PDF upload',
      description:
        'Starts uploading a PDF from your own machine (for a public URL use upload_document). ' +
        'Give its exact sizeBytes (at most 200 MB) and sha256 (hex, e.g. from `shasum -a 256` or ' +
        '`sha256sum`), and the intent as mode: new_document (kind and title required, ocrMode ' +
        'optional) or new_version (documentId and label; once ready the version re-anchors every ' +
        'mark on the document and becomes current, so it returns CONFIRMATION_REQUIRED until ' +
        'called with confirm: true). Editors and owners. Returns uploadId, a put {method, url, ' +
        'headers} and the same as a ready curl command: send the raw file bytes with an HTTP PUT ' +
        '(replace script.pdf with the path), then call complete_document_upload. The bearer ' +
        'secret in the headers is single-purpose: it only accepts this exact file (same size and ' +
        `sha256), at most ${MAX_PUT_ATTEMPTS} attempts, until expiresAt (30 minutes); it is not ` +
        `your access token. At most ${MAX_OPEN_UPLOADS} unfinished uploads at once.`,
      inputSchema: z.object({
        showId: id('show'),
        mode: z
          .enum(['new_document', 'new_version'])
          .describe(
            'new_document adds a document; new_version adds the next version of documentId.',
          ),
        documentId: id('document').optional().describe('new_version: the document to revise.'),
        kind: z.enum(['libretto', 'score', 'blocking', 'other']).optional(),
        title: text.optional().describe('new_document: the title.'),
        ocrMode: z.enum(['auto', 'never']).optional(),
        label: text.optional().describe('new_version: the version label, e.g. "Rehearsal cut 2".'),
        sizeBytes: z.number().int().describe('Exact size of the file in bytes.'),
        sha256: z
          .string()
          .regex(/^[0-9a-fA-F]{64}$/)
          .describe('SHA-256 of the file, 64 hex characters.'),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded(async ({ confirm, ...intent }, ctx) => {
      const actor = mcp.actor(ctx)
      if (intent.mode === 'new_version' && confirm !== true) {
        // Validate and authorise first, so a bad or forbidden call is told so instead of asked to confirm.
        validateUploadIntent(intent)
        const document = await assertUploadTarget(db, actor, intent)
        return confirmationRequired(
          `Once processed, the new version of "${document?.title}" re-anchors every cue and annotation on it (other members' personal notes included) and becomes the current version.`,
        )
      }
      const { upload, secret } = await beginDocumentUpload(db, blobs, actor, intent)
      const url = `${new URL(config.APP_ORIGIN).origin}/api/uploads/${upload.id}`
      const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/pdf' }
      return jsonResult({
        uploadId: upload.id,
        mode: upload.mode,
        showId: upload.showId,
        documentId: upload.documentId,
        sizeBytes: upload.sizeBytes,
        sha256: upload.sha256,
        expiresAt: upload.expiresAt,
        put: { method: 'PUT', url, headers },
        curl: [
          'curl --fail-with-body -sS -T script.pdf',
          `-H ${shellQuote(`Authorization: ${headers.authorization}`)}`,
          `-H ${shellQuote('Content-Type: application/pdf')}`,
          shellQuote(url),
        ].join(' '),
        next: 'PUT the file, then call complete_document_upload with this uploadId.',
      })
    }),
  )

  const uploadArgs = { uploadId: id('upload') }

  server.registerTool(
    'complete_document_upload',
    {
      title: 'Complete a local PDF upload',
      description:
        'Finishes an upload begun with begin_document_upload once its PUT has succeeded: adds the ' +
        'document or version exactly as begun and queues processing (poll get_document until the ' +
        'version is ready). Only the user who began it; the role, token scope and archived state ' +
        'are checked again. Calling it again after success returns the same document and version. ' +
        'Before the PUT it is a conflict. Returns {document, version}.',
      inputSchema: z.object(uploadArgs),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded(async ({ uploadId }, ctx) => {
      const { document, version } = await completeDocumentUpload(db, blobs, jobs, mcp.actor(ctx), {
        uploadId,
      })
      return jsonResult({ document: documentSummary(document), version: versionSummary(version) })
    }),
  )

  server.registerTool(
    'cancel_document_upload',
    {
      title: 'Cancel a local PDF upload',
      description:
        'Discards an upload that has not completed, and any bytes already sent; its PUT URL stops ' +
        'working. A completed upload is a conflict (remove_version removes what it made). Only the ' +
        'user who began it. Unfinished uploads also expire on their own after 30 minutes.',
      inputSchema: z.object(uploadArgs),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded(async ({ uploadId }, ctx) =>
      jsonResult(await cancelDocumentUpload(db, blobs, mcp.actor(ctx), { uploadId })),
    ),
  )
}
