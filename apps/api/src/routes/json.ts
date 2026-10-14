import type { z } from 'zod'
import { invalid, unsupportedMediaType } from '../errors'

interface JsonRequest {
  header(name: string): string | undefined
  json(): Promise<unknown>
}

/**
 * Reads a JSON request body and validates it. Only `application/json` is accepted (415 otherwise):
 * a cross-site form or `fetch(..., { mode: 'no-cors' })` can only send text/plain, form-encoded or
 * multipart bodies without a CORS preflight, so this is a second CSRF barrier behind the Origin check.
 * Unparseable JSON and schema failures are 400.
 */
export async function readJson<T extends z.ZodType>(
  req: JsonRequest,
  schema: T,
): Promise<z.infer<T>> {
  const type = (req.header('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') throw unsupportedMediaType()
  const body = await req.json().catch(() => {
    throw invalid('Request body must be JSON')
  })
  const result = schema.safeParse(body)
  if (!result.success) {
    throw invalid(
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    )
  }
  return result.data
}
