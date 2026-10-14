import { HISTORY_MAX_LIMIT } from '@binder/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { activityFeed, listHistory, revertBatch, revertChange } from '../../services'
import { CONFIRM_DESCRIPTION, CONFIRM_THRESHOLD, confirmationRequired } from '../confirm'
import type { McpContext } from '../context'
import { guarded, jsonResult } from '../results'
import { resolveDepartment } from './cues'

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false }

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const isoDate = (what: string) =>
  z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO 8601 date and time')
    .describe(what)

const LAYER_DESCRIPTION =
  'Only changes on one layer: a department code or id (like LX), "personal" for your own personal ' +
  'layer, or a layer key (department:<id> or personal:<your user id>). A cue moved out of a ' +
  "department still shows in that department's history."
const KIND_DESCRIPTION =
  '"agent": changes made through MCP or other agents; "human": everything else.'
const FORCE_DESCRIPTION =
  'Set true to restore the old values even where the data has changed since. Without it a changed ' +
  'column is a conflict and nothing is written.'

const pageArgs = {
  before: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("The previous page's nextBefore; omit for the newest."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(HISTORY_MAX_LIMIT)
    .optional()
    .describe('Items per page (default 50).'),
}

export function registerHistoryTools(server: McpServer, mcp: McpContext): void {
  const { db } = mcp.deps

  const readFilters = {
    layer: z.string().min(1).optional().describe(LAYER_DESCRIPTION),
    kind: z.enum(['human', 'agent', 'all']).optional().describe(KIND_DESCRIPTION),
    from: isoDate('Only changes at or after this time (ISO 8601).').optional(),
    to: isoDate('Only changes at or before this time (ISO 8601).').optional(),
    ...pageArgs,
  }

  async function layerKey(
    actor: ReturnType<McpContext['actor']>,
    showId: string,
    layer: string | undefined,
  ): Promise<string | undefined> {
    if (layer === undefined) return undefined
    if (layer === 'personal') return `personal:${actor.userId}`
    if (layer.includes(':')) return layer
    return `department:${await resolveDepartment(db, actor, showId, layer)}`
  }

  const dates = (a: { from?: string; to?: string }) => ({
    from: a.from === undefined ? undefined : new Date(a.from),
    to: a.to === undefined ? undefined : new Date(a.to),
  })

  server.registerTool(
    'get_history',
    {
      title: 'Get change history',
      description:
        'Returns the change log of a show, newest first: who changed which row, when, how (web, ' +
        'sync or mcp), and the before and after values of the changed columns. Filter by rowId, ' +
        'table (cues, annotations, departments, documents, shows), layer, userId, kind and a ' +
        "time window. Page back with before set to nextBefore. Other people's personal layers " +
        'are never included. Each entry has a seq, which revert_change takes.',
      inputSchema: z.object({
        showId: id('show'),
        rowId: z.string().min(1).optional().describe('Only changes to this row.'),
        table: z.string().min(1).optional().describe('Only changes to this table.'),
        userId: z.string().min(1).optional().describe('Only changes made by this user.'),
        ...readFilters,
      }),
      annotations: READ,
    },
    guarded(async ({ showId, layer, from, to, ...rest }, ctx) => {
      const actor = mcp.actor(ctx)
      return jsonResult(
        await listHistory(db, actor, {
          showId,
          ...rest,
          layer: await layerKey(actor, showId, layer),
          ...dates({ from, to }),
        }),
      )
    }),
  )

  server.registerTool(
    'get_activity',
    {
      title: 'Get activity feed',
      description:
        'Returns what changed in a show as one line per batch, newest first, such as "moved 3 TM ' +
        'cues and relabelled 1", with who did it (an agent reads "<name> via <agent>"), when, and ' +
        'the first and last change seq. batchId and userId from a group are what revert_batch ' +
        'takes. Use from to ask what changed since a time. Page back with before set to nextBefore.',
      inputSchema: z.object({ showId: id('show'), ...readFilters }),
      annotations: READ,
    },
    guarded(async ({ showId, layer, from, to, ...rest }, ctx) => {
      const actor = mcp.actor(ctx)
      return jsonResult(
        await activityFeed(db, actor, {
          showId,
          ...rest,
          layer: await layerKey(actor, showId, layer),
          ...dates({ from, to }),
        }),
      )
    }),
  )

  server.registerTool(
    'revert_change',
    {
      title: 'Revert one change',
      description:
        'Reverts one change log row (a seq from get_history) by writing its old values back as a ' +
        'new logged change, which can itself be reverted. You need edit rights on the layer it ' +
        'touched. If the data changed since, this is a conflict unless force is true. Changes to ' +
        'cues and annotations can be reverted, including inserts and deletes; for departments, ' +
        'documents and shows only edits can. Returns the new batchId and what was skipped.',
      inputSchema: z.object({
        seq: z.number().int().min(1).describe('The change log seq.'),
        force: z.boolean().optional().describe(FORCE_DESCRIPTION),
      }),
      annotations: WRITE,
    },
    guarded(async (args, ctx) => jsonResult(await revertChange(db, mcp.actor(ctx), args))),
  )

  server.registerTool(
    'revert_batch',
    {
      title: 'Revert a batch of changes',
      description:
        'Reverts every change one user made in one batch (batchId and userId from get_activity), ' +
        'newest first, as one new logged batch. All or nothing: a conflict or a layer you cannot ' +
        `edit refuses the whole call. Changing or deleting more than ${CONFIRM_THRESHOLD} rows ` +
        'returns CONFIRMATION_REQUIRED until called with confirm: true. Returns the new batchId, ' +
        'how many rows were reverted, and what was skipped.',
      inputSchema: z.object({
        showId: id('show'),
        batchId: z.string().min(1).describe('The batchId of an activity group.'),
        userId: id('user who made the batch'),
        force: z.boolean().optional().describe(FORCE_DESCRIPTION),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      }),
      annotations: WRITE,
    },
    guarded(async ({ confirm, ...input }, ctx) => {
      const actor = mcp.actor(ctx)
      if (confirm !== true) {
        const plan = await revertBatch(db, actor, { ...input, dryRun: true })
        if (plan.rows > CONFIRM_THRESHOLD || plan.deletes > CONFIRM_THRESHOLD) {
          return confirmationRequired(
            `Reverting this batch changes ${plan.rows} rows and deletes ${plan.deletes}.`,
          )
        }
      }
      return jsonResult(await revertBatch(db, actor, input))
    }),
  )
}
