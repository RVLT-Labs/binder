import { EXPORT_FILE_TYPES } from '@binder/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { invalid } from '../errors'
import { createExportRecord, listExportRecords } from '../services'
import { assertCanExport } from '../services/exports'
import { MAX_UPLOAD_BYTES, readUpload } from '../upload/multipart'
import { issuesMessage } from '../validation'

export const exportRoutes = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

/** The `meta` field of an export upload. The service validates the ranges; this only shapes the JSON. */
const metaSchema = z.object({
  id: z.string(),
  kind: z.enum(['pdf-script', 'pdf-sheet', 'csv', 'xlsx']),
  filename: z.string(),
  layerSelection: z.array(z.object({ kind: z.enum(['department', 'personal']), id: z.string() })),
  createdAt: z.string().optional(),
})

type Meta = Omit<z.infer<typeof metaSchema>, 'createdAt'> & { createdAt?: Date }

function parseMeta(raw: string | undefined): Meta {
  if (raw === undefined) throw invalid('A "meta" field before the file is required')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw invalid('meta must be JSON')
  }
  const parsed = metaSchema.safeParse(json)
  if (!parsed.success) throw invalid(`meta: ${issuesMessage(parsed.error)}`)
  const { createdAt, ...rest } = parsed.data
  if (createdAt === undefined) return rest
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime()))
    throw invalid('meta.createdAt must be an ISO 8601 date and time')
  return { ...rest, createdAt: date }
}

exportRoutes.get('/shows/:showId/exports', requireUser, async (c) =>
  c.json({
    exports: await listExportRecords(c.var.deps.db, actorOf(c), { showId: c.req.param('showId') }),
  }),
)

// Multipart: a `meta` field (JSON), then the `file`. The file must start with the signature of its kind.
exportRoutes.post('/shows/:showId/exports', requireUser, async (c) => {
  const { db, blobs } = c.var.deps
  const showId = c.req.param('showId')
  await assertCanExport(db, actorOf(c), showId)
  const upload = await readUpload(c, MAX_UPLOAD_BYTES, {
    // The signature the kind needs: `%PDF-` for the PDFs, `PK` for an XLSX, none for a CSV.
    magic: (fields) => EXPORT_FILE_TYPES[parseMeta(fields.meta).kind].magic,
  })
  try {
    const meta = parseMeta(upload.fields.meta)
    const record = await createExportRecord(db, blobs, actorOf(c), {
      ...meta,
      showId,
      file: upload.file.stream,
    })
    return c.json(record, 201)
  } catch (err) {
    upload.file.stream.destroy()
    throw err
  }
})
