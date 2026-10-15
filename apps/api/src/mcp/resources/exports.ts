import type { Readable } from 'node:stream'
import { type McpServer, ResourceTemplate, type Variables } from '@modelcontextprotocol/server'
import { notFound } from '../../errors'
import { readableExport } from '../../services/exports'
import type { McpContext } from '../context'
import { resourceError } from '../results'
import { exportMimeType } from '../tools/exports'

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? ''

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Exports as `binder://shows/{showId}/exports/{exportId}` (spec 3.10), read through the same guard as the blob route. */
export function registerExportResources(server: McpServer, mcp: McpContext): void {
  const { db, blobs } = mcp.deps

  server.registerResource(
    'export',
    new ResourceTemplate('binder://shows/{showId}/exports/{exportId}', { list: undefined }),
    {
      title: 'Export file',
      description:
        'The file of an export record (a marked-up script or cue sheet PDF, CSV or XLSX). ' +
        "An export that includes another member's personal layer is not found.",
      mimeType: 'application/pdf',
    },
    async (uri, vars: Variables, ctx) => {
      try {
        const record = await readableExport(db, mcp.actor(ctx), {
          exportId: one(vars.exportId),
          showId: one(vars.showId),
        })
        const blob = await blobs.get(record.fileKey)
        if (!blob) throw notFound('Export not found')
        const bytes = await bytesOf(blob.stream)
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: exportMimeType(record.kind),
              blob: bytes.toString('base64'),
            },
          ],
        }
      } catch (err) {
        throw resourceError(err, uri.href)
      }
    },
  )
}
