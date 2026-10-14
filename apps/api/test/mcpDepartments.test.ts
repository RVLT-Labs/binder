import type { Client } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createToken, listDepartments, listShowMembers } from '../src/services'
import { setupShow } from './documentHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

type Setup = Awaited<ReturnType<typeof setupShow>>
let s: Setup
let owner: Client
let editor: Client
const clients: Client[] = []
const actorOf = (userId: string) => ({ userId, via: 'web' as const, agent: null })

async function connect(userId: string) {
  const { token } = await createToken(s.deps.db, actorOf(userId), { name: 't', showScope: '*' })
  const c = await connectMcp(s.app, token)
  clients.push(c)
  return c
}

const members = () => listShowMembers(s.deps.db, s.ownerActor, { showId: s.show.id })
const membershipOf = async (userId: string) => {
  const m = (await members()).find((x) => x.userId === userId)
  if (!m) throw new Error('no membership')
  return m.membershipId
}

beforeAll(async () => {
  s = await setupShow()
  owner = await connect(s.owner.id)
  editor = await connect(s.editor.id)
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

describe('department tools', () => {
  test('list_departments returns the seeded codes; create_department by an editor token is an isError forbidden', async () => {
    const listed = await callTool(editor, 'list_departments', { showId: s.show.id })
    expect(listed.isError).toBeFalsy()
    expect(listed.structuredContent?.departments.map((d: { code: string }) => d.code)).toEqual([
      'LX',
      'SND',
      'TM',
      'VID',
      'SM',
      'STG',
      'FLY',
    ])
    const args = { showId: s.show.id, code: 'PYRO', name: 'Pyro', colour: '#FF0000' }
    const denied = await callTool(editor, 'create_department', args)
    expect(denied.isError).toBe(true)
    expect(resultText(denied)).toMatch(/^forbidden:/)

    const made = await callTool(owner, 'create_department', {
      ...args,
      code: 'pyro',
      numberFormat: 'point',
    })
    expect(made.isError).toBeFalsy()
    expect(made.structuredContent).toMatchObject({ code: 'PYRO', numberFormat: 'point' })
    const dup = await callTool(owner, 'create_department', args)
    expect(resultText(dup)).toMatch(/^conflict:/)
    const nul = await callTool(owner, 'create_department', {
      ...args,
      code: 'ZZ',
      name: 'a\u0000b',
    })
    expect(nul.isError).toBe(true)
  })

  test('update_department renames, hides and reorders', async () => {
    const depts = await listDepartments(s.deps.db, s.ownerActor, { showId: s.show.id })
    const vid = depts.find((d) => d.code === 'VID')
    const res = await callTool(owner, 'update_department', {
      departmentId: vid?.id,
      name: 'Projection',
      hidden: true,
      sortOrder: 99,
    })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({
      code: 'VID',
      name: 'Projection',
      hidden: true,
      sortOrder: 99,
    })
    const denied = await callTool(editor, 'update_department', {
      departmentId: vid?.id,
      hidden: false,
    })
    expect(resultText(denied)).toMatch(/^forbidden:/)
  })
})

describe('member tools', () => {
  test('list_show_members shows emails to owners only', async () => {
    const asOwner = await callTool(owner, 'list_show_members', { showId: s.show.id })
    expect(asOwner.structuredContent?.members).toHaveLength(3)
    expect(
      asOwner.structuredContent?.members.every(
        (m: { email: unknown }) => typeof m.email === 'string',
      ),
    ).toBe(true)
    const asEditor = await callTool(editor, 'list_show_members', { showId: s.show.id })
    expect(
      asEditor.structuredContent?.members.every((m: { email: unknown }) => m.email === null),
    ).toBe(true)
  })

  test('update_show_member accepts department codes and stores department ids', async () => {
    const depts = await listDepartments(s.deps.db, s.ownerActor, { showId: s.show.id })
    const id = (c: string) => depts.find((d) => d.code === c)?.id
    const res = await callTool(owner, 'update_show_member', {
      membershipId: await membershipOf(s.editor.id),
      departments: ['lx', id('SND')],
    })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent?.departments).toEqual([id('LX'), id('SND')])
    const stored = (await members()).find((m) => m.userId === s.editor.id)
    expect(stored?.departments).toEqual([id('LX'), id('SND')])

    const star = await callTool(owner, 'update_show_member', {
      membershipId: await membershipOf(s.editor.id),
      departments: ['*'],
    })
    expect(star.structuredContent?.departments).toEqual(['*'])
    const unknown = await callTool(owner, 'update_show_member', {
      membershipId: await membershipOf(s.editor.id),
      departments: ['NOPE'],
    })
    expect(unknown.isError).toBe(true)
    expect(resultText(unknown)).toMatch(/^invalid:.*NOPE/)
    const mixed = await callTool(owner, 'update_show_member', {
      membershipId: await membershipOf(s.editor.id),
      departments: ['*', 'LX'],
    })
    expect(resultText(mixed)).toMatch(/^invalid:/)
    const denied = await callTool(editor, 'update_show_member', {
      membershipId: await membershipOf(s.editor.id),
      role: 'viewer',
    })
    expect(resultText(denied)).toMatch(/^forbidden:/)
  })

  test('granting owner needs confirm: true and writes nothing without it', async () => {
    const membershipId = await membershipOf(s.viewer.id)
    const gated = await callTool(owner, 'update_show_member', { membershipId, role: 'owner' })
    expect(gated.isError).toBe(true)
    expect(gated.structuredContent?.code).toBe('CONFIRMATION_REQUIRED')
    expect(gated.structuredContent?.summary).toMatch(/owner/i)
    expect(resultText(gated)).toMatch(
      /^CONFIRMATION_REQUIRED: .*Call again with confirm: true to proceed\.$/,
    )
    expect((await members()).find((m) => m.userId === s.viewer.id)?.role).toBe('viewer')

    // Ordinary changes are not gated.
    const ok = await callTool(owner, 'update_show_member', { membershipId, role: 'editor' })
    expect(ok.isError).toBeFalsy()

    const confirmed = await callTool(owner, 'update_show_member', {
      membershipId,
      role: 'owner',
      confirm: true,
    })
    expect(confirmed.isError).toBeFalsy()
    expect((await members()).find((m) => m.userId === s.viewer.id)?.role).toBe('owner')

    // Taking owner away is gated too.
    const demote = await callTool(owner, 'update_show_member', { membershipId, role: 'viewer' })
    expect(demote.structuredContent?.code).toBe('CONFIRMATION_REQUIRED')
    expect((await members()).find((m) => m.userId === s.viewer.id)?.role).toBe('owner')
    const demoted = await callTool(owner, 'update_show_member', {
      membershipId,
      role: 'viewer',
      confirm: true,
    })
    expect(demoted.isError).toBeFalsy()
  })

  test('a non-owner is told forbidden, not asked to confirm', async () => {
    const res = await callTool(editor, 'update_show_member', {
      membershipId: await membershipOf(s.viewer.id),
      role: 'owner',
    })
    expect(resultText(res)).toMatch(/^forbidden:/)
  })

  test('add_show_member and remove_show_member need confirm: true', async () => {
    const extra = await (async () => {
      const email = `extra${Date.now()}@doc.test`
      const { id } = await (await import('./helpers')).createTestUser(s.app, s.deps, {
        email,
        name: 'Xtra',
        password: 'password123',
      })
      return { id, email }
    })()
    const addArgs = { showId: s.show.id, email: extra.email, role: 'viewer', departments: ['LX'] }
    const gated = await callTool(owner, 'add_show_member', addArgs)
    expect(gated.structuredContent?.code).toBe('CONFIRMATION_REQUIRED')
    expect((await members()).some((m) => m.userId === extra.id)).toBe(false)

    const added = await callTool(owner, 'add_show_member', { ...addArgs, confirm: true })
    expect(added.isError).toBeFalsy()
    const lx = (await listDepartments(s.deps.db, s.ownerActor, { showId: s.show.id })).find(
      (d) => d.code === 'LX',
    )
    expect(added.structuredContent?.departments).toEqual([lx?.id])

    const unknown = await callTool(owner, 'add_show_member', {
      ...addArgs,
      email: `nobody${Date.now()}@doc.test`,
      departments: ['NOPE'],
      confirm: true,
    })
    expect(resultText(unknown)).toMatch(/^invalid:/)

    const membershipId = await membershipOf(extra.id)
    const rmGated = await callTool(owner, 'remove_show_member', { membershipId })
    expect(rmGated.structuredContent?.code).toBe('CONFIRMATION_REQUIRED')
    expect((await members()).some((m) => m.userId === extra.id)).toBe(true)
    const denied = await callTool(editor, 'remove_show_member', { membershipId, confirm: true })
    expect(resultText(denied)).toMatch(/^forbidden:/)
    const removed = await callTool(owner, 'remove_show_member', { membershipId, confirm: true })
    expect(removed.isError).toBeFalsy()
    expect((await members()).some((m) => m.userId === extra.id)).toBe(false)
  })
})
