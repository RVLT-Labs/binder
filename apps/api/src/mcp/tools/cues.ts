import { parseCueNumber } from '@binder/core'
import type { Actor } from '@binder/shared'
import { type Anchor, type CueFields, cueFieldsSchema } from '@binder/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { invalid } from '../../errors'
import { createCue, deleteCues, getCue, getDocument, listCues, updateCue } from '../../services'
import type { Executor } from '../../services/executor'
import { CONFIRM_DESCRIPTION, CONFIRM_THRESHOLD, confirmationRequired } from '../confirm'
import type { McpContext } from '../context'
import { guarded, jsonResult, pageArgs, paginate } from '../results'
import { resolveDepartmentRefs } from './departments'

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
const REMOVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true }

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const fields = cueFieldsSchema.shape

const DEPARTMENT_DESCRIPTION = 'The department code (like LX) or id; the cue lives on its layer.'
const NUMBER_DESCRIPTION =
  'The cue number as text with at most two decimals, like "14" or "14.5" (14.50 is the same). ' +
  'Omit on create to take the next number from the neighbours in script order.'

const placement = z.object({
  documentId: id('document'),
  pageIndex: z.number().int().min(0).max(100000).describe('Zero-based page index.'),
  x: z.number().finite().min(0).max(14400).describe('PDF points from the left.'),
  y: z.number().finite().min(0).max(14400).describe('PDF points from the bottom.'),
})
type Placement = z.infer<typeof placement>

async function resolveDepartment(
  db: Executor,
  actor: Actor,
  showId: string,
  ref: string,
): Promise<string> {
  const [resolved] = await resolveDepartmentRefs(db, actor, showId, [ref])
  if (resolved === '*') throw invalid('unknown department: *')
  return resolved
}

/** The anchor for a hand placement: the document's current version, status ok. */
async function anchorFor(db: Executor, actor: Actor, p: Placement): Promise<Anchor> {
  const { document } = await getDocument(db, actor, { documentId: p.documentId })
  if (!document.currentVersionId) throw invalid('the document has no current version')
  return { ...p, documentVersionId: document.currentVersionId, status: 'ok' }
}

function numberOf(text: string): { major: number; minor: number } {
  const n = parseCueNumber(text)
  if (!n) throw invalid(`number must be a decimal like 14 or 14.5 (at most two decimals): ${text}`)
  return n
}

export function registerCueTools(server: McpServer, mcp: McpContext): void {
  const { db } = mcp.deps

  server.registerTool(
    'list_cues',
    {
      title: 'List cues',
      description:
        "Lists a show's cues sorted by department then number. Each cue has id, departmentCode, " +
        'display (the number as the department shows it), label, type (go, standby, warn), notes, ' +
        'colour, duplicate (another cue in the department has the same number) and anchor ' +
        '(documentId, documentVersionId, pageIndex, x, y in PDF points; null when unplaced). ' +
        'Filter by department, documentId, or placed.',
      inputSchema: z.object({
        showId: id('show'),
        department: z.string().min(1).optional().describe(DEPARTMENT_DESCRIPTION),
        documentId: z.string().min(1).optional().describe('Only cues anchored in this document.'),
        placed: z.boolean().optional().describe('true: only placed cues; false: only unplaced.'),
        ...pageArgs,
      }),
      annotations: READ,
    },
    guarded(async ({ showId, department, documentId, placed, ...page }, ctx) => {
      const actor = mcp.actor(ctx)
      const departmentId = department
        ? await resolveDepartment(db, actor, showId, department)
        : undefined
      const all = await listCues(db, actor, { showId, departmentId, documentId, placed })
      return jsonResult(paginate(all, page))
    }),
  )

  server.registerTool(
    'get_cue',
    {
      title: 'Get cue',
      description: 'Returns one cue with its display number, department code and duplicate flag.',
      inputSchema: z.object({ cueId: id('cue') }),
      annotations: READ,
    },
    guarded(async (args, ctx) => jsonResult(await getCue(db, mcp.actor(ctx), args))),
  )

  server.registerTool(
    'create_cue',
    {
      title: 'Create cue',
      description:
        'Creates a cue on a department layer. You need edit rights on that layer. Without a ' +
        'number the next one is chosen from the department neighbours in script order; with an ' +
        'anchor ({documentId, pageIndex, x, y}) it is placed on the current version of that ' +
        'document, otherwise it is unplaced. Returns the cue.',
      inputSchema: z.object({
        showId: id('show'),
        department: z.string().min(1).describe(DEPARTMENT_DESCRIPTION),
        number: z.string().optional().describe(NUMBER_DESCRIPTION),
        label: fields.label.optional(),
        type: fields.type.optional(),
        notes: fields.notes.optional(),
        colour: fields.colour.optional().describe('#RRGGBB, or null for the department colour.'),
        anchor: placement.optional(),
      }),
      annotations: CREATE,
    },
    guarded(async (args, ctx) => {
      const actor = mcp.actor(ctx)
      const { showId, department, number, anchor, ...rest } = args
      const departmentId = await resolveDepartment(db, actor, showId, department)
      const cue = await createCue(db, actor, {
        ...rest,
        showId,
        departmentId,
        number: number === undefined ? undefined : numberOf(number),
        anchor: anchor ? await anchorFor(db, actor, anchor) : undefined,
      })
      return jsonResult(await getCue(db, actor, { cueId: cue.id }))
    }),
  )

  server.registerTool(
    'update_cue',
    {
      title: 'Update cue',
      description:
        'Changes a cue: its number, label, type, notes, colour, department (needs edit rights on ' +
        'both layers) or anchor ({documentId, pageIndex, x, y}; null makes it unplaced). Fields ' +
        'you omit are unchanged. Returns the cue.',
      inputSchema: z.object({
        cueId: id('cue'),
        number: z.string().optional().describe(NUMBER_DESCRIPTION),
        label: fields.label.optional(),
        type: fields.type.optional(),
        notes: fields.notes.optional(),
        colour: fields.colour.optional(),
        department: z.string().min(1).optional().describe(DEPARTMENT_DESCRIPTION),
        anchor: placement.nullable().optional(),
      }),
      annotations: UPDATE,
    },
    guarded(async ({ cueId, number, department, anchor, ...rest }, ctx) => {
      const actor = mcp.actor(ctx)
      const current = await getCue(db, actor, { cueId })
      const patch: Partial<CueFields> = { ...rest }
      if (number !== undefined) Object.assign(patch, numberOf(number))
      if (department !== undefined) {
        patch.departmentId = await resolveDepartment(db, actor, current.showId, department)
      }
      if (anchor !== undefined) {
        patch.anchor = anchor === null ? null : await anchorFor(db, actor, anchor)
      }
      await updateCue(db, actor, { cueId, patch })
      return jsonResult(await getCue(db, actor, { cueId }))
    }),
  )

  server.registerTool(
    'delete_cues',
    {
      title: 'Delete cues',
      description:
        'Deletes cues. All or nothing: if you cannot edit one of them, none is deleted. More than ' +
        `${CONFIRM_THRESHOLD} cues returns CONFIRMATION_REQUIRED until called with confirm: true. ` +
        'Returns the deleted ids.',
      inputSchema: z.object({
        cueIds: z.array(id('cue')).min(1).max(1000),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      }),
      annotations: REMOVE,
    },
    guarded(async ({ cueIds, confirm }, ctx) => {
      const actor = mcp.actor(ctx)
      const unique = [...new Set(cueIds)]
      if (unique.length > CONFIRM_THRESHOLD && confirm !== true) {
        const views = await Promise.all(unique.map((cueId) => getCue(db, actor, { cueId })))
        const codes = [...new Set(views.map((v) => v.departmentCode))].sort()
        return confirmationRequired(`This deletes ${unique.length} cues from ${codes.join(', ')}.`)
      }
      return jsonResult(await deleteCues(db, actor, { cueIds: unique }))
    }),
  )
}
