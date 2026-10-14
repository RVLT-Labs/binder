import {
  type Actor,
  type Anchor,
  type AnnotationFields,
  annotationObjectSchema,
  type LayerRef,
  layerKey,
  parseLayerKey,
} from '@binder/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import {
  type Annotation,
  createAnnotation,
  deleteAnnotations,
  getAnnotation,
  listAnnotations,
  listDepartments,
  updateAnnotation,
} from '../../services'
import type { Executor } from '../../services/executor'
import { CONFIRM_DESCRIPTION, CONFIRM_THRESHOLD, confirmationRequired } from '../confirm'
import type { McpContext } from '../context'
import { guarded, jsonResult, pageArgs, paginate } from '../results'
import { anchorFor, placement, resolveDepartment } from './cues'

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
const REMOVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true }

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const fields = annotationObjectSchema.shape

const LAYER_DESCRIPTION =
  "'personal' for your own private layer, or a department code (like LX) or id, or a layer key " +
  '(department:<id>). Your personal layer is visible to you alone.'
const GEOMETRY_DESCRIPTION =
  'In PDF points, relative to the anchor. rect and ellipse: {w, h}, each above 0, the anchor being ' +
  'the bottom-left corner. line and arrow: {dx, dy} from the anchor (the start), not both 0. ' +
  'note, stamp and highlight take none ({}).'

/** The anchor point, plus the quote a highlight is bound to. */
const annotationPlacement = placement.extend({
  text: z
    .object({
      quote: fields.anchor.shape.text.unwrap().shape.quote,
      wordStart: z.number().int().min(0).describe('Index of the first word on the page.'),
      wordEnd: z.number().int().min(0).describe('Index of the last word on the page, inclusive.'),
    })
    .optional()
    .describe('Required for a highlight: the words it covers.'),
})
type AnnotationPlacement = z.infer<typeof annotationPlacement>

async function resolveLayer(
  db: Executor,
  actor: Actor,
  showId: string,
  ref: string,
): Promise<LayerRef> {
  // Exact match only: a department may be coded PERSONAL, which stays reachable by id.
  if (ref === 'personal') return { kind: 'personal', id: actor.userId }
  const key = parseLayerKey(ref)
  if (key) return key
  return { kind: 'department', id: await resolveDepartment(db, actor, showId, ref) }
}

/** A moved annotation keeps its bound words (`current.text`) unless the placement names new ones. */
async function anchorOf(
  db: Executor,
  actor: Actor,
  p: AnnotationPlacement,
  current?: Anchor,
): Promise<Anchor> {
  const { text: given, ...point } = p
  const anchor = await anchorFor(db, actor, point)
  const text = given ?? current?.text
  return text ? { ...anchor, text } : anchor
}

/** The row plus its layer key, which is what `layer` arguments and the change log call it. */
const view = (a: Annotation) => ({ ...a, layer: layerKey({ kind: a.layerKind, id: a.layerId }) })

export function registerAnnotationTools(server: McpServer, mcp: McpContext): void {
  const { db } = mcp.deps

  server.registerTool(
    'list_annotations',
    {
      title: 'List annotations',
      description:
        "Lists a show's annotations (note, rect, ellipse, line, arrow, stamp, highlight) oldest " +
        'first: every department layer plus your own personal layer; other people’s personal ' +
        'layers are never shown. Each has id, layer (a layer key), layerKind, layerId, type, ' +
        'anchor (documentId, documentVersionId, pageIndex, x, y in PDF points), geometry ' +
        '(relative to the anchor), text and style. Filter by layer or documentId.',
      inputSchema: z.object({
        showId: id('show'),
        layer: z.string().min(1).optional().describe(LAYER_DESCRIPTION),
        documentId: z
          .string()
          .min(1)
          .optional()
          .describe('Only annotations anchored in this document.'),
        ...pageArgs,
      }),
      annotations: READ,
    },
    guarded(async ({ showId, layer, documentId, ...page }, ctx) => {
      const actor = mcp.actor(ctx)
      const resolved = layer ? await resolveLayer(db, actor, showId, layer) : undefined
      const all = await listAnnotations(db, actor, { showId, layer: resolved, documentId })
      return jsonResult(paginate(all.map(view), page))
    }),
  )

  server.registerTool(
    'get_annotation',
    {
      title: 'Get annotation',
      description:
        'Returns one annotation. Another user’s personal annotation is not_found, like a missing id.',
      inputSchema: z.object({ annotationId: id('annotation') }),
      annotations: READ,
    },
    guarded(async (args, ctx) => jsonResult(view(await getAnnotation(db, mcp.actor(ctx), args)))),
  )

  server.registerTool(
    'create_annotation',
    {
      title: 'Create annotation',
      description:
        'Draws on a layer: your personal layer, or a department layer you can edit. The anchor ' +
        '({documentId, pageIndex, x, y}) is placed on the current version of that document. ' +
        'A note needs text, a stamp 1 to 40 characters (the show’s stamp set is in its settings), ' +
        'a highlight an anchor text range; shapes need geometry. Returns the annotation.',
      inputSchema: z.object({
        showId: id('show'),
        layer: z.string().min(1).describe(LAYER_DESCRIPTION),
        type: fields.type,
        anchor: annotationPlacement,
        geometry: fields.geometry.optional().describe(GEOMETRY_DESCRIPTION),
        text: fields.text.optional(),
        style: fields.style
          .optional()
          .describe('{colour: #RRGGBB, strokeWidth: 0.5 to 12, fontSize: 6 to 72}.'),
      }),
      annotations: CREATE,
    },
    guarded(async ({ showId, layer, anchor, geometry, text, style, type }, ctx) => {
      const actor = mcp.actor(ctx)
      const resolved = await resolveLayer(db, actor, showId, layer)
      const created = await createAnnotation(db, actor, {
        showId,
        layerKind: resolved.kind,
        layerId: resolved.id,
        anchor: await anchorOf(db, actor, anchor),
        type,
        geometry: geometry ?? {},
        text: text ?? '',
        style: style ?? {},
      })
      return jsonResult(view(created))
    }),
  )

  server.registerTool(
    'update_annotation',
    {
      title: 'Update annotation',
      description:
        'Changes an annotation: its layer (needs edit rights on both layers), type, anchor ' +
        '({documentId, pageIndex, x, y}), geometry, text or style. Fields you omit are unchanged; ' +
        'the result must still be valid as a whole (a rect keeps w and h). Returns the annotation.',
      inputSchema: z.object({
        annotationId: id('annotation'),
        layer: z.string().min(1).optional().describe(LAYER_DESCRIPTION),
        type: fields.type.optional(),
        anchor: annotationPlacement.optional(),
        geometry: fields.geometry.optional().describe(GEOMETRY_DESCRIPTION),
        text: fields.text.optional(),
        style: fields.style.optional(),
      }),
      annotations: UPDATE,
    },
    guarded(async ({ annotationId, layer, anchor, ...rest }, ctx) => {
      const actor = mcp.actor(ctx)
      const current = await getAnnotation(db, actor, { annotationId })
      const patch: Partial<AnnotationFields> = { ...rest }
      if (layer !== undefined) {
        const resolved = await resolveLayer(db, actor, current.showId, layer)
        patch.layerKind = resolved.kind
        patch.layerId = resolved.id
      }
      if (anchor !== undefined) patch.anchor = await anchorOf(db, actor, anchor, current.anchor)
      await updateAnnotation(db, actor, { annotationId, patch })
      return jsonResult(view(await getAnnotation(db, actor, { annotationId })))
    }),
  )

  server.registerTool(
    'delete_annotations',
    {
      title: 'Delete annotations',
      description:
        'Deletes annotations. All or nothing: if you cannot edit one of them, none is deleted. ' +
        `More than ${CONFIRM_THRESHOLD} annotations returns CONFIRMATION_REQUIRED until called ` +
        'with confirm: true. Returns the deleted ids.',
      inputSchema: z.object({
        annotationIds: z.array(id('annotation')).min(1).max(1000),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      }),
      annotations: REMOVE,
    },
    guarded(async ({ annotationIds, confirm }, ctx) => {
      const actor = mcp.actor(ctx)
      const unique = [...new Set(annotationIds)]
      if (unique.length > CONFIRM_THRESHOLD && confirm !== true) {
        const rows = await Promise.all(
          unique.map((annotationId) => getAnnotation(db, actor, { annotationId })),
        )
        const codes = new Map<string, string>()
        for (const showId of new Set(rows.map((r) => r.showId))) {
          for (const d of await listDepartments(db, actor, { showId })) codes.set(d.id, d.code)
        }
        const layers = [
          ...new Set(
            rows.map((r) =>
              r.layerKind === 'personal'
                ? 'your personal layer'
                : (codes.get(r.layerId) ?? r.layerId),
            ),
          ),
        ].sort()
        return confirmationRequired(
          `This deletes ${unique.length} annotations from ${layers.join(', ')}.`,
        )
      }
      return jsonResult(await deleteAnnotations(db, actor, { annotationIds: unique }))
    }),
  )
}
