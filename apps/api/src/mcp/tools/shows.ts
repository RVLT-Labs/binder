import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { invalid } from '../../errors'
import {
  addShowMember,
  createOrganisation,
  createShow,
  getShow,
  latestChangePerShow,
  listOrganisations,
  listShows,
  presenceSummary,
  requireShowRole,
  updateShow,
} from '../../services'
import { email, jsonRecord, memberDepartments, title } from '../../validation'
import { CONFIRM_DESCRIPTION, confirmationRequired } from '../confirm'
import type { McpContext } from '../context'
import { guarded, jsonResult, pageArgs, paginate } from '../results'
import { DEPARTMENTS_DESCRIPTION, resolveDepartmentRefs } from './departments'

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const showStatus = z.enum(['prep', 'rehearsal', 'running', 'archived'])
const role = z.enum(['owner', 'editor', 'viewer'])

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true }

type ShowLike = { id: string; title: string; status: string; organisationId: string; role: string }
const summary = (s: ShowLike) => ({
  id: s.id,
  title: s.title,
  status: s.status,
  organisationId: s.organisationId,
  role: s.role,
})

export function registerShowTools(server: McpServer, mcp: McpContext): void {
  const { db } = mcp.deps

  server.registerTool(
    'list_organisations',
    {
      title: 'List organisations',
      description:
        'Lists the organisations you belong to, with their ids. Shows live inside an organisation; ' +
        'pass an organisation id to create_show to choose where a new show goes. Paginated.',
      inputSchema: z.object({ ...pageArgs }),
      annotations: READ,
    },
    guarded(async (args, ctx) => {
      const orgs = await listOrganisations(db, mcp.actor(ctx))
      const page = paginate(
        orgs.map((o) => ({ id: o.id, name: o.name })),
        args,
      )
      return jsonResult({ organisations: page.items, nextCursor: page.nextCursor })
    }),
  )

  server.registerTool(
    'create_organisation',
    {
      title: 'Create organisation',
      description:
        'Creates an organisation (a company or venue that owns shows) with you as its owner and ' +
        'returns it. Needs a token that is not limited to particular shows.',
      inputSchema: z.object({ name: title.describe('Organisation name.') }),
      annotations: CREATE,
    },
    guarded(async (args, ctx) => jsonResult(await createOrganisation(db, mcp.actor(ctx), args))),
  )

  server.registerTool(
    'list_shows',
    {
      title: 'List shows',
      description:
        'Lists the shows you can reach with this token, split into active and archived, each with ' +
        'its id, title, status and your role (owner, editor or viewer). Start here: the show id ' +
        'is what list_documents and the other show tools take. Paginated over active then archived. ' +
        'inNow lists the people who have the show open right now (name and departments, empty ' +
        'when nobody): check it before a bulk edit, since you would be changing the binder under ' +
        'them. lastChange is the newest change anyone made (who, a one-line sentence, when), or ' +
        'null when nothing has changed.',
      inputSchema: z.object({ ...pageArgs }),
      annotations: READ,
    },
    guarded(async (args, ctx) => {
      const actor = mcp.actor(ctx)
      const { active, archived } = await listShows(db, actor)
      const [changes, presence] = await Promise.all([
        latestChangePerShow(db, actor),
        presenceSummary(db, mcp.deps.presence, actor),
      ])
      const page = paginate(
        [...active, ...archived].map((s) => ({
          ...summary(s),
          // archived shows carry neither, as on the cards
          inNow:
            s.status === 'archived'
              ? []
              : (presence.shows[s.id]?.people ?? []).map((p) => ({
                  userId: p.userId,
                  name: p.name,
                  departments: p.departments,
                })),
          lastChange: changes[s.id] ?? null,
        })),
        args,
      )
      return jsonResult({
        active: page.items.filter((s) => s.status !== 'archived'),
        archived: page.items.filter((s) => s.status === 'archived'),
        nextCursor: page.nextCursor,
      })
    }),
  )

  server.registerTool(
    'get_show',
    {
      title: 'Get show',
      description:
        'Returns one show: title, status, settings, your role on it and how many members it has.',
      inputSchema: z.object({ showId: id('show') }),
      annotations: READ,
    },
    guarded(async (args, ctx) => jsonResult(await getShow(db, mcp.actor(ctx), args))),
  )

  server.registerTool(
    'create_show',
    {
      title: 'Create show',
      description:
        'Creates a show with you as its owner and returns it (use its id in later calls). It goes ' +
        'in organisationId, or in your first organisation when omitted. Needs a token that is not ' +
        'limited to particular shows.',
      inputSchema: z.object({
        organisationId: id('organisation').optional(),
        title: title.describe('Show title.'),
      }),
      annotations: CREATE,
    },
    guarded(async (args, ctx) => {
      const actor = mcp.actor(ctx)
      let organisationId = args.organisationId
      if (!organisationId) {
        const [first] = await listOrganisations(db, actor)
        if (!first) throw invalid('You belong to no organisation; call create_organisation first')
        organisationId = first.id
      }
      return jsonResult(await createShow(db, actor, { organisationId, title: args.title }))
    }),
  )

  server.registerTool(
    'update_show',
    {
      title: 'Update show',
      description:
        "Changes a show's title, status (prep, rehearsal, running, archived) or settings. Owners " +
        'only. An archived show is read-only except for changing its status back. Returns the show.',
      inputSchema: z.object({
        showId: id('show'),
        title: title.optional(),
        status: showStatus.optional(),
        settings: jsonRecord.optional().describe('Replaces all settings.'),
      }),
      annotations: UPDATE,
    },
    guarded(async ({ showId, ...patch }, ctx) =>
      jsonResult(await updateShow(db, mcp.actor(ctx), { showId, patch })),
    ),
  )

  server.registerTool(
    'add_show_member',
    {
      title: 'Add show member',
      description:
        'Adds an existing Binder user to a show by email with a role: owner, editor or viewer. ' +
        'departments limits an editor to those departments, by code (like LX) or id (default ' +
        'all). Owners only. Returns CONFIRMATION_REQUIRED until called with confirm: true, since ' +
        'it gives someone access to the show. Returns the membership.',
      inputSchema: z.object({
        showId: id('show'),
        email,
        role,
        departments: memberDepartments.optional().describe(DEPARTMENTS_DESCRIPTION),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      }),
      annotations: CREATE,
    },
    guarded(async ({ confirm, departments, ...args }, ctx) => {
      const actor = mcp.actor(ctx)
      // Owner check first: a non-owner is told forbidden, and nobody can probe emails unconfirmed.
      await requireShowRole(db, actor, args.showId, 'owner')
      if (confirm !== true) {
        return confirmationRequired(
          `This adds ${args.email} to the show as ${args.role}, giving them access to every document and layer they can see.`,
        )
      }
      const resolved =
        departments === undefined
          ? undefined
          : await resolveDepartmentRefs(db, actor, args.showId, departments)
      return jsonResult(await addShowMember(db, actor, { ...args, departments: resolved }))
    }),
  )
}
