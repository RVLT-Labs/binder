import { z } from 'zod'
import { COLOUR_RE } from './markup'

/** Postgres rejects NUL in text and jsonb, so every string schema here refuses it. */
const str = () => z.string().refine((s) => !s.includes('\u0000'), 'must not contain NUL')
const id = () => str().min(1).max(200)
const coord = () => z.number().finite().min(0).max(14400)

const textAnchorSchema = z
  .object({
    quote: str().min(1).max(400),
    wordStart: z.number().int().min(-1),
    wordEnd: z.number().int().min(-1),
  })
  .refine((t) => t.wordEnd >= t.wordStart, { message: 'wordEnd must be >= wordStart' })

export const anchorSchema = z.object({
  documentId: id(),
  documentVersionId: id(),
  pageIndex: z.number().int().min(0).max(100000),
  x: coord(),
  y: coord(),
  text: textAnchorSchema.optional(),
  status: z.enum(['ok', 'approximate', 'unresolved']),
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
