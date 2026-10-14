import {
  type CallToolResult,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  type ServerContext,
} from '@modelcontextprotocol/server'
import * as z from 'zod'
import { AppError } from '../errors'

/** Dates become ISO strings; the result is plain JSON as `structuredContent` requires. */
export function toJson<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

/** A successful result: `structuredContent`, and the same JSON as text for clients that only read text. */
export function jsonResult(data: unknown): CallToolResult {
  const structured = toJson(data)
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  }
}

/** Service errors become tool errors the agent can read (`code: message`); anything else is hidden. */
export function toolError(err: unknown): CallToolResult {
  if (err instanceof AppError) {
    return { isError: true, content: [{ type: 'text', text: `${err.code}: ${err.message}` }] }
  }
  console.error('mcp tool failed', err)
  return { isError: true, content: [{ type: 'text', text: 'internal: Internal server error' }] }
}

/** Wraps a tool handler so a thrown error is returned as a tool error result. */
export function guarded<A>(
  handler: (args: A, ctx: ServerContext) => Promise<CallToolResult>,
): (args: A, ctx: ServerContext) => Promise<CallToolResult> {
  return async (args, ctx) => {
    try {
      return await handler(args, ctx)
    } catch (err) {
      return toolError(err)
    }
  }
}

const DEFAULT_PAGE_SIZE = 50

/** Pagination arguments shared by the list tools. */
export const pageArgs = {
  cursor: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe("Opaque cursor from a previous call's nextCursor; omit for the first page."),
  limit: z.number().int().min(1).max(200).optional().describe('Items per page (default 50).'),
}

/** One page of `items` and the cursor for the next page, if there is one. */
export function paginate<T>(
  items: T[],
  args: { cursor?: string; limit?: number },
): { items: T[]; nextCursor?: string } {
  const start = Number(args.cursor ?? 0)
  const end = start + (args.limit ?? DEFAULT_PAGE_SIZE)
  return end < items.length
    ? { items: items.slice(start, end), nextCursor: String(end) }
    : { items: items.slice(start) }
}

/** Service errors for resource reads: not_found as the SDK's not-found error, others as invalid params. */
export function resourceError(err: unknown, uri: string): Error {
  if (err instanceof AppError) {
    if (err.code === 'not_found') return new ResourceNotFoundError(uri, err.message)
    return new ProtocolError(ProtocolErrorCode.InvalidParams, `${err.code}: ${err.message}`)
  }
  console.error('mcp resource read failed', err)
  return new ProtocolError(ProtocolErrorCode.InternalError, 'Internal server error')
}
