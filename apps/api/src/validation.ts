import { COLOUR_RE, DEPARTMENT_CODE_RE, DEPARTMENT_NAME_MAX } from '@binder/shared'
import { z } from 'zod'
import { invalid } from './errors'

/**
 * Input validation shared by the sync policy, REST routes, MCP tools and services. Postgres rejects
 * NUL in text and jsonb, so a value carrying one must be refused up front (400 or a sync rejection),
 * never reach the database where it would surface as a 500 or a retry loop.
 */
export const noNul = (s: string): boolean => !s.includes('\u0000')

/** Walks a JSON value; JSON.stringify escapes NUL, so the strings themselves must be checked. */
export function hasNoNul(value: unknown): boolean {
  if (typeof value === 'string') return noNul(value)
  if (Array.isArray(value)) return value.every(hasNoNul)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(([k, v]) => noNul(k) && hasNoNul(v))
  }
  return true
}

export const int32 = z.number().int().min(-2147483648).max(2147483647)

/** Trimmed text of 1 to `max` characters without NUL. */
export const text = (max: number) =>
  z.string().trim().min(1).max(max).refine(noNul, 'must not contain NUL')

/** Titles and names of organisations, shows and documents. */
export const title = text(200)

/** A JSON object without NUL anywhere inside it (show settings). */
export const jsonRecord = z.record(z.string(), z.unknown()).refine(hasNoNul, 'must not contain NUL')

export const email = z.email().max(254).refine(noNul, 'must not contain NUL')

/** Codes are trimmed and upper-cased before they are checked and stored. */
export const normaliseCode = (s: string): string => s.trim().toUpperCase()

export const departmentFields = {
  /** Validates the normalised form; the service stores `normaliseCode(code)`. */
  code: z
    .string()
    .max(64)
    .refine(noNul, 'must not contain NUL')
    .refine(
      (s) => DEPARTMENT_CODE_RE.test(normaliseCode(s)),
      'must be 1 to 8 letters or digits starting with a letter',
    ),
  name: text(DEPARTMENT_NAME_MAX),
  colour: z.string().regex(COLOUR_RE, 'must be a colour like #F5A623'),
  numberFormat: z.enum(['decimal', 'point']),
  sortOrder: int32,
  hidden: z.boolean(),
} as const

/** A member's department scope: `['*']` or ids; ids are checked against the show by the service. */
export const memberDepartments = z.array(text(100)).min(1).max(200)

/** The first issue of a zod failure as the `invalid` message services and routes share. */
export function issuesMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ')
}

/** Parses `value` with `schema`, throwing `invalid` with every issue on failure. */
export function parseOrInvalid<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw invalid(issuesMessage(result.error))
  return result.data
}
