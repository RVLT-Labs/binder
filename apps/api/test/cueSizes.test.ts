import { changeLog, shows } from '@binder/db'
import { type Actor, newId } from '@binder/shared'
import type { Client } from '@modelcontextprotocol/client'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import {
  createOrganisation,
  createShow,
  createToken,
  getShow,
  listDepartments,
  updateShow,
} from '../src/services'
import { applyCrudBatch } from '../src/sync/apply'
import { setupShow } from './documentHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

type Setup = Awaited<ReturnType<typeof setupShow>>
let s: Setup
let lx: string
let snd: string
const clients: Client[] = []
const web = (userId: string): Actor => ({ userId, via: 'web', agent: null })
const sync = (userId: string): Actor => ({ userId, via: 'sync', agent: null })
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )
const settingsOf = async () =>
  (await getShow(s.deps.db, s.ownerActor, { showId: s.show.id })).settings as Record<
    string,
    unknown
  >

beforeAll(async () => {
  s = await setupShow()
  const depts = await listDepartments(s.deps.db, s.ownerActor, { showId: s.show.id })
  lx = depts.find((d) => d.code === 'LX')?.id as string
  snd = depts.find((d) => d.code === 'SND')?.id as string
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

describe('settings.cueSizes through updateShow', () => {
  test('the owner sets a department large; it is stored, read back, logged, and other keys are kept', async () => {
    const before = { paperSize: 'Letter', markerSides: { [snd]: 'right' } }
    await updateShow(s.deps.db, s.ownerActor, { showId: s.show.id, patch: { settings: before } })
    const batchId = newId()
    const next = { ...before, cueSizes: { [lx]: 'large' } }
    await updateShow(s.deps.db, s.ownerActor, {
      showId: s.show.id,
      patch: { settings: next },
      batchId,
    })
    expect(await settingsOf()).toEqual(next)
    const logs = await s.deps.db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.batchId, batchId), eq(changeLog.tableName, 'shows')))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.after).toEqual({ settings: next })
    // Back to normal is a plain write too.
    await updateShow(s.deps.db, s.ownerActor, {
      showId: s.show.id,
      patch: { settings: { ...before, cueSizes: { [lx]: 'normal' } } },
    })
    expect((await settingsOf()).cueSizes).toEqual({ [lx]: 'normal' })
  })

  test('settings without cueSizes are accepted exactly as before', async () => {
    const plain = { stampSet: ['Go'], anything: { nested: true } }
    await updateShow(s.deps.db, s.ownerActor, { showId: s.show.id, patch: { settings: plain } })
    expect(await settingsOf()).toEqual(plain)
  })

  test('an invalid size, shape or department is refused as invalid and nothing changes', async () => {
    const kept = await settingsOf()
    const otherOrg = await createOrganisation(s.deps.db, s.ownerActor, { name: 'Elsewhere' })
    const other = await createShow(s.deps.db, s.ownerActor, {
      organisationId: otherOrg.id,
      title: 'Other',
    })
    const [foreign] = await listDepartments(s.deps.db, s.ownerActor, { showId: other.id })
    for (const cueSizes of [
      { [lx]: 'huge' },
      { [lx]: 1.3 },
      { [lx]: { size: 'large' } },
      'large',
      ['large'],
      null,
      { [newId()]: 'large' },
      { [foreign?.id as string]: 'large' },
    ]) {
      const attempt = updateShow(s.deps.db, s.ownerActor, {
        showId: s.show.id,
        patch: { settings: { ...kept, cueSizes } },
      })
      expect(await code(attempt), JSON.stringify(cueSizes)).toBe('invalid')
    }
    expect(await settingsOf()).toEqual(kept)
  })

  test('an entry already stored for a department id is kept on a later write even if unchanged', async () => {
    // A stale entry (say, written before validation) must not block unrelated edits.
    const stale = newId()
    await s.deps.db
      .update(shows)
      .set({ settings: { cueSizes: { [stale]: 'large' } } })
      .where(eq(shows.id, s.show.id))
    await updateShow(s.deps.db, s.ownerActor, {
      showId: s.show.id,
      patch: { settings: { cueSizes: { [stale]: 'large', [lx]: 'large' }, paperSize: 'A4' } },
    })
    expect((await settingsOf()).cueSizes).toEqual({ [stale]: 'large', [lx]: 'large' })
    // ...but it cannot be changed to anything but a valid size.
    expect(
      await code(
        updateShow(s.deps.db, s.ownerActor, {
          showId: s.show.id,
          patch: { settings: { cueSizes: { [stale]: 'tiny', [lx]: 'large' } } },
        }),
      ),
    ).toBe('invalid')
  })

  test('editors and viewers cannot change cue sizes; they can read them', async () => {
    const settings = { cueSizes: { [snd]: 'large' } }
    for (const who of [s.editor, s.viewer, s.outsider]) {
      expect(
        await code(updateShow(s.deps.db, web(who.id), { showId: s.show.id, patch: { settings } })),
      ).toBe(who === s.outsider ? 'not_found' : 'forbidden')
    }
    const read = await getShow(s.deps.db, web(s.viewer.id), { showId: s.show.id })
    expect((read.settings as Record<string, unknown>).cueSizes).toBeDefined()
  })
})

describe('settings.cueSizes through the sync write path', () => {
  test('an owner PATCH as JSON text applies; a bad one is rejected invalid; an editor is forbidden', async () => {
    const good = JSON.stringify({ cueSizes: { [snd]: 'large' } })
    const ok = await applyCrudBatch(s.deps.db, sync(s.owner.id), {
      batchId: newId(),
      entries: [{ table: 'shows', id: s.show.id, op: 'PATCH', data: { settings: good } }],
    })
    expect(ok).toEqual({ applied: 1, rejected: [] })
    expect((await settingsOf()).cueSizes).toEqual({ [snd]: 'large' })

    const bad = await applyCrudBatch(s.deps.db, sync(s.owner.id), {
      batchId: newId(),
      entries: [
        {
          table: 'shows',
          id: s.show.id,
          op: 'PATCH',
          data: { settings: JSON.stringify({ cueSizes: { [snd]: 'jumbo' } }) },
        },
      ],
    })
    expect(bad.applied).toBe(0)
    expect(bad.rejected.map((r) => r.reason)).toEqual(['invalid'])

    const editor = await applyCrudBatch(s.deps.db, sync(s.editor.id), {
      batchId: newId(),
      entries: [{ table: 'shows', id: s.show.id, op: 'PATCH', data: { settings: good } }],
    })
    expect(editor.rejected.map((r) => r.reason)).toEqual(['forbidden'])
    expect((await settingsOf()).cueSizes).toEqual({ [snd]: 'large' })
  })

  test('replaying the same offline batch is a no-op', async () => {
    const batchId = newId()
    const req = {
      batchId,
      entries: [
        {
          table: 'shows',
          id: s.show.id,
          op: 'PATCH' as const,
          data: { settings: JSON.stringify({ cueSizes: { [lx]: 'large', [snd]: 'large' } }) },
        },
      ],
    }
    expect(await applyCrudBatch(s.deps.db, sync(s.owner.id), req)).toEqual({
      applied: 1,
      rejected: [],
    })
    expect(await applyCrudBatch(s.deps.db, sync(s.owner.id), req)).toMatchObject({ replay: true })
    expect((await settingsOf()).cueSizes).toEqual({ [lx]: 'large', [snd]: 'large' })
  })
})

describe('settings.cueSizes through MCP', () => {
  async function connect(userId: string) {
    const { token } = await createToken(s.deps.db, web(userId), { name: 't', showScope: '*' })
    const c = await connectMcp(s.app, token)
    clients.push(c)
    return c
  }

  test('update_show sets it and get_show reads it back; a bad value is an invalid error; an editor is forbidden', async () => {
    const owner = await connect(s.owner.id)
    const editor = await connect(s.editor.id)
    const settings = { paperSize: 'A4', cueSizes: { [lx]: 'large' } }
    const set = await callTool(owner, 'update_show', { showId: s.show.id, settings })
    expect(set.isError).toBeFalsy()
    const got = await callTool(editor, 'get_show', { showId: s.show.id })
    expect(got.isError).toBeFalsy()
    expect(got.structuredContent?.settings).toEqual(settings)

    const bad = await callTool(owner, 'update_show', {
      showId: s.show.id,
      settings: { cueSizes: { [lx]: 'xl' } },
    })
    expect(bad.isError).toBe(true)
    expect(resultText(bad)).toMatch(/^invalid:.*cueSizes/)

    const denied = await callTool(editor, 'update_show', { showId: s.show.id, settings })
    expect(denied.isError).toBe(true)
    expect(resultText(denied)).toMatch(/^forbidden:/)
    expect((await settingsOf()).cueSizes).toEqual({ [lx]: 'large' })
  })
})
