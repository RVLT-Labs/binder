import { parseCueNumber, withMark } from '@binder/core'
import type { Actor } from '@binder/shared'
import {
  type Anchor,
  CUE_MARKS,
  type CueFields,
  type CueMark,
  cueFieldsSchema,
} from '@binder/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { invalid } from '../../errors'
import {
  createCue,
  deleteCues,
  getCue,
  getDocument,
  listCues,
  placeCueAtText,
  renumberCues,
  updateCue,
} from '../../services'
import type { Executor } from '../../services/executor'
import { MAX_CHAR_OFFSET, restyleAnchor } from '../../services/placement'
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

const markEnum = z.enum(CUE_MARKS as [CueMark, ...CueMark[]])
const MARK_DESCRIPTION =
  'How the cue marks its place in the script: underline (the default), highlight (a translucent ' +
  'fill over the whole quote), line (a vertical bar at a character position) or pointer (a bar ' +
  'with a small triangle on top).'
const CHAR_OFFSET_DESCRIPTION =
  'Only with mark line or pointer: how many characters into the first word of the anchor the bar ' +
  `sits, from 0 (before the first character) up to the word's length (after its last); at most ` +
  `${MAX_CHAR_OFFSET}. Default 0.`

export const placement = z.object({
  documentId: id('document'),
  pageIndex: z.number().int().min(0).max(100000).describe('Zero-based page index.'),
  x: z.number().finite().min(0).max(14400).describe('PDF points from the left.'),
  y: z.number().finite().min(0).max(14400).describe('PDF points from the bottom.'),
  mark: markEnum
    .optional()
    .describe(
      `${MARK_DESCRIPTION} A placement by coordinates binds no word, so a line or pointer is a ` +
        'free bar at (x, y) and an underline or highlight falls back to a tick. Cues only.',
    ),
})
export type Placement = z.infer<typeof placement>

export async function resolveDepartment(
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
export async function anchorFor(db: Executor, actor: Actor, p: Placement): Promise<Anchor> {
  const { document } = await getDocument(db, actor, { documentId: p.documentId })
  if (!document.currentVersionId) throw invalid('the document has no current version')
  const { mark, ...point } = p
  const anchor: Anchor = { ...point, documentVersionId: document.currentVersionId, status: 'ok' }
  return mark ? withMark(anchor, mark) : anchor
}

function numberOf(text: string): { major: number; minor: number } {
  const n = parseCueNumber(text)
  if (!n) throw invalid(`number must be a decimal like 14 or 14.5 (at most two decimals): ${text}`)
  return n
}

export function registerCueTools(server: McpServer, mcp: McpContext): void {
  const { db, blobs } = mcp.deps

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
    'place_cue_at_text',
    {
      title: 'Place cue at text',
      description:
        'Places a cue on a department layer where a line of the script occurs, so you can mark up ' +
        'a script without pixel coordinates. Quote the text as it appears in the document ' +
        '(case, punctuation and a hyphenated line end are forgiven when there is no exact match). ' +
        'The document defaults to the libretto. Returns {status: "placed", cue, match} with the ' +
        'cue anchored at the first word of the quote (mark highlight: over the whole quote; mark ' +
        'line or pointer: a bar at charOffset characters into the first word). If the quote appears more than once nothing ' +
        'is written and you get {status: "ambiguous", matches: [{occurrence, pageIndex, snippet}]}: ' +
        'call again with occurrence (1-based, from that list) or nearPageIndex (the occurrence ' +
        'nearest that page). A quote that is nowhere in the document is an error. Without a ' +
        'number the next one is chosen from the department neighbours in script order. You need ' +
        'edit rights on the department layer.',
      inputSchema: z.object({
        showId: id('show'),
        department: z.string().min(1).describe(DEPARTMENT_DESCRIPTION),
        quote: z
          .string()
          .min(1)
          .max(2000)
          .describe('A few words of the script as they appear on the page, in reading order.'),
        documentId: id('document').optional().describe('Defaults to the show libretto.'),
        occurrence: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .optional()
          .describe('Which occurrence to use when the quote appears more than once (1-based).'),
        nearPageIndex: z
          .number()
          .int()
          .min(0)
          .max(100000)
          .optional()
          .describe('When the quote appears more than once, the zero-based page to be nearest to.'),
        number: z.string().optional().describe(NUMBER_DESCRIPTION),
        label: fields.label.optional(),
        type: fields.type.optional(),
        notes: fields.notes.optional(),
        mark: markEnum
          .optional()
          .describe(
            `${MARK_DESCRIPTION} A highlight covers the whole matched quote, not just its first ` +
              'eight words.',
          ),
        charOffset: z
          .number()
          .int()
          .min(0)
          .max(MAX_CHAR_OFFSET)
          .optional()
          .describe(
            `${CHAR_OFFSET_DESCRIPTION} An error with underline or highlight, or past the end of ` +
              'the first word of the quote.',
          ),
      }),
      annotations: CREATE,
    },
    guarded(async ({ number, ...rest }, ctx) => {
      const result = await placeCueAtText(db, blobs, mcp.actor(ctx), {
        ...rest,
        number: number === undefined ? undefined : numberOf(number),
      })
      return jsonResult(result)
    }),
  )

  server.registerTool(
    'renumber_cues',
    {
      title: 'Renumber cues from script order',
      description:
        "Renumbers one department's cues anchored in one document by script order (page, then top " +
        'to bottom): the first cue takes the block size (default 10) and the rest the following ' +
        'integers, and minors reset to zero. Cues in a long scene that overflow a block spill into ' +
        'points and are flagged. Unplaced cues, the 0 range (line checks) and other documents are ' +
        'untouched and their numbers are not avoided, so a renumbered cue can land on one: both are ' +
        "then flagged 'duplicate'. Importing never renumbers. Name the department with departmentId, " +
        'or with department (code or id) and showId. You need edit rights on the department layer. ' +
        'It is one revertable batch. Returns {changed, flagged: [{cueId, reason}]}, reason ' +
        "'spilled', 'overflow' or 'duplicate'.",
      inputSchema: z.object({
        departmentId: id('department').optional(),
        showId: id('show').optional().describe('Required with department.'),
        department: z.string().min(1).optional().describe(DEPARTMENT_DESCRIPTION),
        documentId: id('document'),
        blockSize: z
          .number()
          .int()
          .min(2)
          .max(1000)
          .optional()
          .describe('The block each group starts on, default 10.'),
      }),
      annotations: UPDATE,
    },
    guarded(async ({ departmentId, showId, department, documentId, blockSize }, ctx) => {
      const actor = mcp.actor(ctx)
      if ((departmentId === undefined) === (department === undefined)) {
        throw invalid('give either departmentId, or department with showId')
      }
      let resolved = departmentId
      if (resolved === undefined) {
        if (showId === undefined) throw invalid('department needs showId')
        resolved = await resolveDepartment(db, actor, showId, department as string)
      }
      return jsonResult(
        await renumberCues(db, actor, { departmentId: resolved, documentId, blockSize }),
      )
    }),
  )

  server.registerTool(
    'update_cue',
    {
      title: 'Update cue',
      description:
        'Changes a cue: its number, label, type, notes, colour, department (needs edit rights on ' +
        'both layers) or anchor ({documentId, pageIndex, x, y, mark?}; null makes it unplaced). ' +
        'mark and charOffset restyle the cue where it stands, keeping its quote: mark switches ' +
        'between underline, highlight, line and pointer, and charOffset moves a line or pointer ' +
        'within the first word of its anchor (x follows). With an anchor too, the new anchor is ' +
        'applied first and mark and charOffset on top of it. They are errors on an unplaced cue, ' +
        'and charOffset is an error on a cue bound to no word or without a line or pointer mark. ' +
        'Fields you omit are unchanged. Returns the cue.',
      inputSchema: z.object({
        cueId: id('cue'),
        number: z.string().optional().describe(NUMBER_DESCRIPTION),
        label: fields.label.optional(),
        type: fields.type.optional(),
        notes: fields.notes.optional(),
        colour: fields.colour.optional(),
        department: z.string().min(1).optional().describe(DEPARTMENT_DESCRIPTION),
        anchor: placement.nullable().optional(),
        mark: markEnum
          .optional()
          .describe(`${MARK_DESCRIPTION} Applied to the cue's current (or new) anchor.`),
        charOffset: z
          .number()
          .int()
          .min(0)
          .max(MAX_CHAR_OFFSET)
          .optional()
          .describe(
            `${CHAR_OFFSET_DESCRIPTION} Clamped to the word. An error on a cue bound to no word, ` +
              'or one whose mark is not a line or pointer.',
          ),
      }),
      annotations: UPDATE,
    },
    guarded(async ({ cueId, number, department, anchor, mark, charOffset, ...rest }, ctx) => {
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
      if (mark !== undefined || charOffset !== undefined) {
        const base = anchor !== undefined ? patch.anchor : current.anchor
        if (!base) throw invalid('the cue is unplaced; place it before changing its mark')
        patch.anchor = await restyleAnchor(db, blobs, base, { mark, charOffset })
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
