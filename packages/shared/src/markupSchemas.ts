import { z } from 'zod'
import {
  type AnnotationType,
  COLOUR_RE,
  CUE_MARKS,
  CUE_SIZES,
  type CueMark,
  type CueSize,
  isCaretMark,
  QUOTE_MAX_CHARS,
} from './markup'

/** Postgres rejects NUL in text and jsonb, so every string schema here refuses it. */
const str = () => z.string().refine((s) => !s.includes('\u0000'), 'must not contain NUL')
const id = () => str().min(1).max(200)
const coord = () => z.number().finite().min(0).max(14400)

/** `settings.cueSizes`: department id to `normal` or `large`. Nothing else is accepted. */
export const cueSizesSchema = z.record(id(), z.enum(CUE_SIZES as [CueSize, ...CueSize[]]))

const textAnchorSchema = z
  .object({
    quote: str().min(1).max(QUOTE_MAX_CHARS),
    wordStart: z.number().int().min(-1),
    wordEnd: z.number().int().min(-1),
    offset: z.number().int().min(0).max(1000).optional(),
  })
  .refine((t) => t.wordEnd >= t.wordStart, { message: 'wordEnd must be >= wordStart' })

const bubbleOffsetSchema = z.object({
  dx: z.number().finite().min(-14400).max(14400),
  dy: z.number().finite().min(-14400).max(14400),
})

export const anchorSchema = z
  .object({
    documentId: id(),
    documentVersionId: id(),
    pageIndex: z.number().int().min(0).max(100000),
    x: coord(),
    y: coord(),
    text: textAnchorSchema.optional(),
    mark: z.enum(CUE_MARKS as [CueMark, ...CueMark[]]).optional(),
    tag: bubbleOffsetSchema.optional(),
    status: z.enum(['ok', 'approximate', 'unresolved']),
  })
  .superRefine((a, ctx) => {
    if (a.text?.offset === undefined) return
    if (a.text.wordStart < 0 || !a.mark || !isCaretMark(a.mark)) {
      ctx.addIssue({
        code: 'custom',
        path: ['text', 'offset'],
        message: 'a text offset needs a bound word and a line or pointer mark',
      })
    }
  })

export const cueFieldsSchema = z.object({
  departmentId: id(),
  major: z.number().int().min(0).max(9999),
  minor: z.number().int().min(0).max(99),
  label: str().max(200),
  type: z.enum(['go', 'standby', 'warn']),
  notes: str().max(10000),
  colour: z.string().regex(COLOUR_RE, 'must be a colour like #F5A623').nullable(),
  anchor: anchorSchema.nullable(),
})

const MAX_POINTS = 14400
const ANNOTATION_TYPES = ['note', 'rect', 'ellipse', 'line', 'arrow', 'stamp', 'highlight'] as const

/**
 * Geometry is relative to the anchor, in points (so re-anchoring moves a shape with its anchor).
 * A rect or ellipse extends right and up from the anchor, its bottom-left corner; a line or arrow
 * runs from the anchor by (dx, dy); everything else carries none.
 */
export function geometrySchema(type: AnnotationType) {
  switch (type) {
    case 'rect':
    case 'ellipse':
      return z.strictObject({
        w: z.number().gt(0).max(MAX_POINTS),
        h: z.number().gt(0).max(MAX_POINTS),
      })
    case 'line':
    case 'arrow':
      return z
        .strictObject({
          dx: z.number().min(-MAX_POINTS).max(MAX_POINTS),
          dy: z.number().min(-MAX_POINTS).max(MAX_POINTS),
        })
        .refine((g) => g.dx !== 0 || g.dy !== 0, { message: 'dx and dy must not both be 0' })
    default:
      return z.strictObject({})
  }
}

export const styleSchema = z.strictObject({
  colour: z.string().regex(COLOUR_RE, 'must be a colour like #F5A623').optional(),
  strokeWidth: z.number().min(0.5).max(12).optional(),
  fontSize: z.number().min(6).max(72).optional(),
})

/** The annotation fields without the cross-field rules; `annotationFieldsSchema` adds them. */
export const annotationObjectSchema = z.object({
  layerKind: z.enum(['department', 'personal']),
  layerId: id(),
  anchor: anchorSchema,
  type: z.enum(ANNOTATION_TYPES),
  geometry: z.record(z.string(), z.number()),
  text: str().max(2000),
  style: styleSchema,
})

/** Every annotation field is optional, each still bounded; the service checks the merged row. */
export const annotationPatchSchema = annotationObjectSchema.partial()

/**
 * A highlight that re-anchoring left unbound (-1, -1, status `unresolved`). Creating one is allowed so
 * that reverting its deletion, or a personal undo re-inserting it, is not refused; any other create
 * needs a bound word range.
 */
function isUnboundRestore(anchor: z.infer<typeof anchorSchema>): boolean {
  return (
    anchor.status === 'unresolved' && anchor.text?.wordStart === -1 && anchor.text.wordEnd === -1
  )
}

/**
 * The cross-field rules: geometry fits the type, a note has text, a stamp 1 to 40 characters, a
 * highlight an anchor text range. `wordStart >= 0` is enforced on create only (bar the unbound restore
 * above): re-anchoring can leave a highlight unbound (-1, -1), and accepting or moving it must still validate.
 */
export function annotationFieldsSchema(mode: 'create' | 'update') {
  return annotationObjectSchema.superRefine((a, ctx) => {
    const geometry = geometrySchema(a.type).safeParse(a.geometry)
    if (!geometry.success) {
      for (const issue of geometry.error.issues) {
        ctx.addIssue({ code: 'custom', path: ['geometry', ...issue.path], message: issue.message })
      }
    }
    if (
      a.anchor.mark !== undefined ||
      a.anchor.tag !== undefined ||
      a.anchor.text?.offset !== undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['anchor'],
        message: 'an annotation anchor takes no mark, tag or text offset',
      })
    }
    const text = a.text.trim()
    if (a.type === 'note' && text.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'a note needs text' })
    }
    if (a.type === 'stamp' && (text.length === 0 || a.text.length > 40)) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'a stamp needs 1 to 40 characters' })
    }
    if (a.type === 'highlight') {
      if (!a.anchor.text) {
        ctx.addIssue({ code: 'custom', path: ['anchor'], message: 'a highlight needs anchor text' })
      } else if (mode === 'create' && a.anchor.text.wordStart < 0 && !isUnboundRestore(a.anchor)) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchor', 'text', 'wordStart'],
          message: 'a new highlight needs a bound word range',
        })
      }
    }
  })
}
