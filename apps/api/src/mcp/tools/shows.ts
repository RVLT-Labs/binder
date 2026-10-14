import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { invalid } from '../../errors'
import {
  addShowMember,
  createOrganisation,
  createShow,
  getShow,
  listOrganisations,
  listShows,
  updateShow,
} from '../../services'
import type { McpContext } from '../context'
import { guarded, jsonResult, pageArgs, paginate } from '../results'

const id = (what: string) => z.string().min(1).describe(`The ${what} id.`)
const title = z.string().trim().min(1).max(200)
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
        'is what list_documents and the other show tools take. Paginated over active then archived.',
      inputSchema: z.object({ ...pageArgs }),
      annotations: READ,
    },
    guarded(async (args, ctx) => {
      const { active, archived } = await listShows(db, mcp.actor(ctx))
      const page = paginate([...active, ...archived].map(summary), args)
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
        settings: z.record(z.string(), z.unknown()).optional().describe('Replaces all settings.'),
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
        'departments limits an editor to those departments (default all). Owners only. Returns ' +
        'the membership.',
      inputSchema: z.object({
        showId: id('show'),
        email: z.email(),
        role,
        departments: z.array(z.string().min(1)).min(1).optional(),
      }),
      annotations: CREATE,
    },
    guarded(async (args, ctx) => jsonResult(await addShowMember(db, mcp.actor(ctx), args))),
  )
}
