import type { CallToolResult } from '@modelcontextprotocol/server'

/** Spec 3.10: deleting or changing more than this many rows in one call needs `confirm: true`. */
export const CONFIRM_THRESHOLD = 10

/**
 * The answer to a hard-to-reverse call made without `confirm: true`: nothing was written. The agent
 * reads the summary, asks the person, and calls again with `confirm: true`.
 */
export function confirmationRequired(summary: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `CONFIRMATION_REQUIRED: ${summary} Call again with confirm: true to proceed.`,
      },
    ],
    structuredContent: { code: 'CONFIRMATION_REQUIRED', summary },
  }
}

/** The shared `confirm` tool argument. */
export const CONFIRM_DESCRIPTION =
  'Set true to proceed once the person has agreed; without it this returns CONFIRMATION_REQUIRED and changes nothing.'
