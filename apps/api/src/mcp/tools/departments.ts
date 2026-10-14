import type { Actor } from '@binder/shared'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { invalid } from '../../errors'
import {
  createDepartment,
  listDepartments,
  listShowMembers,
  removeShowMember,
  updateDepartment,
  updateShowMember,
} from '../../services'
import type { Executor } from '../../services/executor'
import { loadMembershipAsOwner } from '../../services/tenancy'
import { departmentFields, memberDepartments } from '../../validation'
import { CONFIRM_DESCRIPTION, confirmationRequired } from '../confirm'
import type { McpContext } from '../context'
import { guarded, jsonResult } from '../results'

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
const REMOVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true }

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const role = z.enum(['owner', 'editor', 'viewer'])

/** How `departments` is described wherever a member's scope is set. */
export const DEPARTMENTS_DESCRIPTION =
  "Department codes (like LX) or ids that this member may edit, or ['*'] for all departments. " +
  'Only editors are limited by it.'

/**
 * Turns department codes and ids into ids, so agents can say `LX`. `'*'` passes through (the
 * service rejects it mixed with ids). An unknown entry is `invalid` and names the entry.
 */
export async function resolveDepartmentRefs(
  db: Executor,
  actor: Actor,
  showId: string,
  refs: string[],
): Promise<string[]> {
  if (!refs.some((r) => r !== '*')) return refs
  const all = await listDepartments(db, actor, { showId })
  return refs.map((ref) => {
    if (ref === '*') return ref
    const match =
      all.find((d) => d.id === ref) ?? all.find((d) => d.code === ref.trim().toUpperCase())
    if (!match) throw invalid(`unknown department: ${ref}`)
    return match.id
  })
}

export function registerDepartmentTools(server: McpServer, mcp: McpContext): void {
  const { db } = mcp.deps

  server.registerTool(
    'list_departments',
    {
      title: 'List departments',
      description:
        "Lists a show's departments (layers): id, code (like LX), name, colour, number format " +
        '(decimal shows 10.5, point shows 10.50), sort order and whether it is hidden. Tools that ' +
        'take a department accept the code or the id.',
      inputSchema: z.object({ showId: id('show') }),
      annotations: READ,
    },
    guarded(async (args, ctx) =>
      jsonResult({ departments: await listDepartments(db, mcp.actor(ctx), args) }),
    ),
  )

  server.registerTool(
    'create_department',
    {
      title: 'Create department',
      description:
        'Adds a department to a show. code is 1 to 8 letters or digits starting with a letter ' +
        '(upper-cased), unique in the show; colour is #RRGGBB. Owners only. Returns the department.',
      inputSchema: z.object({
        showId: id('show'),
        code: departmentFields.code,
        name: departmentFields.name,
        colour: departmentFields.colour,
        numberFormat: departmentFields.numberFormat.optional(),
      }),
      annotations: CREATE,
    },
    guarded(async (args, ctx) => jsonResult(await createDepartment(db, mcp.actor(ctx), args))),
  )

  server.registerTool(
    'update_department',
    {
      title: 'Update department',
      description:
        'Renames, recolours, reorders or hides a department, or changes its code or number ' +
        'format. Departments are never deleted; hide one instead (its cues stay). Owners only. ' +
        'Returns the department.',
      inputSchema: z.object({
        departmentId: id('department'),
        code: departmentFields.code.optional(),
        name: departmentFields.name.optional(),
        colour: departmentFields.colour.optional(),
        numberFormat: departmentFields.numberFormat.optional(),
        sortOrder: departmentFields.sortOrder.optional(),
        hidden: departmentFields.hidden.optional(),
      }),
      annotations: UPDATE,
    },
    guarded(async ({ departmentId, ...patch }, ctx) =>
      jsonResult(await updateDepartment(db, mcp.actor(ctx), { departmentId, patch })),
    ),
  )

  server.registerTool(
    'list_show_members',
    {
      title: 'List show members',
      description:
        "Lists a show's members with their id, name, role (owner, editor, viewer) and department " +
        'scope (department ids, or * for all). Emails are shown to owners only.',
      inputSchema: z.object({ showId: id('show') }),
      annotations: READ,
    },
    guarded(async (args, ctx) =>
      jsonResult({ members: await listShowMembers(db, mcp.actor(ctx), args) }),
    ),
  )

  server.registerTool(
    'update_show_member',
    {
      title: 'Update show member',
      description:
        "Changes a member's role or the departments an editor may edit. Owners only. Making " +
        'someone an owner, or taking ownership away, returns CONFIRMATION_REQUIRED until called ' +
        'with confirm: true. The last owner cannot be demoted. Returns the membership.',
      inputSchema: z.object({
        membershipId: id('membership'),
        role: role.optional(),
        departments: memberDepartments.optional().describe(DEPARTMENTS_DESCRIPTION),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      }),
      annotations: UPDATE,
    },
    guarded(async ({ membershipId, role: nextRole, departments, confirm }, ctx) => {
      const actor = mcp.actor(ctx)
      // Loading as owner first means a non-owner is told forbidden, never asked to confirm.
      const { membership } = await loadMembershipAsOwner(db, actor, membershipId)
      const grants = nextRole === 'owner' && membership.role !== 'owner'
      const revokes = membership.role === 'owner' && nextRole !== undefined && nextRole !== 'owner'
      if ((grants || revokes) && confirm !== true) {
        const who = await memberName(db, actor, membership.showId, membershipId)
        return confirmationRequired(
          grants
            ? `This makes ${who} an owner of the show, so they can change members, settings and every layer.`
            : `This takes ownership away from ${who} and makes them ${nextRole}.`,
        )
      }
      const resolved =
        departments === undefined
          ? undefined
          : await resolveDepartmentRefs(db, actor, membership.showId, departments)
      return jsonResult(
        await updateShowMember(db, actor, { membershipId, role: nextRole, departments: resolved }),
      )
    }),
  )

  server.registerTool(
    'remove_show_member',
    {
      title: 'Remove show member',
      description:
        'Removes a member from a show; they lose access immediately. Owners only. Returns ' +
        'CONFIRMATION_REQUIRED until called with confirm: true. The last owner cannot be removed.',
      inputSchema: z.object({
        membershipId: id('membership'),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      }),
      annotations: REMOVE,
    },
    guarded(async ({ membershipId, confirm }, ctx) => {
      const actor = mcp.actor(ctx)
      const { membership } = await loadMembershipAsOwner(db, actor, membershipId)
      if (confirm !== true) {
        const who = await memberName(db, actor, membership.showId, membershipId)
        return confirmationRequired(
          `This removes ${who} (${membership.role}) from the show; they lose access immediately.`,
        )
      }
      return jsonResult(await removeShowMember(db, actor, { membershipId }))
    }),
  )
}

/** A member's display name for a confirmation summary. */
export async function memberName(
  db: Executor,
  actor: Actor,
  showId: string,
  membershipId: string,
): Promise<string> {
  const members = await listShowMembers(db, actor, { showId })
  return members.find((m) => m.membershipId === membershipId)?.name ?? 'this member'
}
