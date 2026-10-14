import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  changeLog,
  departments as departmentsTable,
  organisations,
  showMemberships,
  shows,
} from '@binder/db'
import { type Actor, DEFAULT_DEPARTMENTS, layerKey } from '@binder/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import {
  addShowMember,
  createDepartment,
  createShow,
  listDepartments,
  listOrganisations,
  listShowMembers,
  removeShowMember,
  updateDepartment,
  updateShow,
  updateShowMember,
} from '../src/services'
import { getMembershipScope, requireLayerEdit } from '../src/services/layers'
import { asJson, setupShow } from './documentHelpers'
import { APP_ORIGIN } from './helpers'

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )
const actorOf = (userId: string): Actor => ({ userId, via: 'web', agent: null })

async function setup() {
  const s = await setupShow()
  const db = s.deps.db
  const editorActor = actorOf(s.editor.id)
  const viewerActor = actorOf(s.viewer.id)
  const depts = await listDepartments(db, s.ownerActor, { showId: s.show.id })
  const byCode = (c: string) => {
    const d = depts.find((x) => x.code === c)
    if (!d) throw new Error(`no ${c}`)
    return d
  }
  const members = await listShowMembers(db, s.ownerActor, { showId: s.show.id })
  const membershipOf = (userId: string) => {
    const m = members.find((x) => x.userId === userId)
    if (!m) throw new Error('no membership')
    return m.membershipId
  }
  return { ...s, db, editorActor, viewerActor, depts, byCode, membershipOf }
}

describe('departments', () => {
  test('a new show is seeded with LX, SND, TM, VID, SM, STG, FLY', async () => {
    const { db, ownerActor, show } = await setup()
    const depts = await listDepartments(db, ownerActor, { showId: show.id })
    expect(depts.map((d) => d.code)).toEqual(['LX', 'SND', 'TM', 'VID', 'SM', 'STG', 'FLY'])
    expect(depts.map((d) => d.sortOrder)).toEqual([0, 10, 20, 30, 40, 50, 60])
    expect(depts.find((d) => d.code === 'TM')?.numberFormat).toBe('point')
    expect(depts.filter((d) => d.code !== 'TM').every((d) => d.numberFormat === 'decimal')).toBe(
      true,
    )
    expect(depts.map((d) => [d.name, d.colour])).toEqual(
      DEFAULT_DEPARTMENTS.map((d) => [d.name, d.colour]),
    )
    expect(depts.every((d) => !d.hidden)).toBe(true)
  })

  test('seeding is logged once per department with its layer key', async () => {
    const { db, show } = await setup()
    const rows = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.showId, show.id), eq(changeLog.tableName, 'departments')))
    expect(rows).toHaveLength(7)
    expect(rows.every((r) => r.op === 'insert' && r.before === null)).toBe(true)
    expect(rows.every((r) => r.layer === layerKey({ kind: 'department', id: r.rowId }))).toBe(true)
    // The show-level rows (membership, show) belong to no layer.
    const others = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.showId, show.id), eq(changeLog.tableName, 'shows')))
    expect(others.every((r) => r.layer === null)).toBe(true)
  })

  test('the backfill seeds shows created before departments existed and is idempotent', async () => {
    const { db, show } = await setup()
    const dir = join(__dirname, '../../../packages/db/drizzle')
    const file = readdirSync(dir).find((f) => f.endsWith('_departments_sync.sql'))
    expect(file).toBeDefined()
    const statements = readFileSync(join(dir, file as string), 'utf8').split(
      '--> statement-breakpoint',
    )
    const runMigration = async () => {
      for (const stmt of statements) await db.execute(sql.raw(stmt))
    }

    const [org] = await db.select().from(organisations).limit(1)
    const [bare] = await db
      .insert(shows)
      .values({
        id: `bare-${Date.now()}`,
        organisationId: org.id,
        title: 'Old show',
        updatedBy: 'x',
      })
      .returning()
    const countFor = async (showId: string) =>
      (await db.select().from(departmentsTable).where(eq(departmentsTable.showId, showId))).length
    expect(await countFor(bare.id)).toBe(0)

    await runMigration()
    expect(await countFor(bare.id)).toBe(7)
    await runMigration()
    expect(await countFor(bare.id)).toBe(7)
    expect(await countFor(show.id)).toBe(7)

    const seeded = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.showId, bare.id))
      .orderBy(asc(departmentsTable.sortOrder))
    // The SQL copy of the defaults must not drift from DEFAULT_DEPARTMENTS.
    expect(seeded.map((d) => [d.code, d.name, d.colour, d.numberFormat])).toEqual(
      DEFAULT_DEPARTMENTS.map((d) => [d.code, d.name, d.colour, d.numberFormat]),
    )
    expect(seeded.map((d) => d.sortOrder)).toEqual([0, 10, 20, 30, 40, 50, 60])
    expect(seeded.every((d) => d.updatedBy === 'system')).toBe(true)
    expect(new Set(seeded.map((d) => d.id)).size).toBe(7)
  })

  test('owner creates and renames a department; editor and viewer are forbidden', async () => {
    const { db, ownerActor, editorActor, viewerActor, outsider, show } = await setup()
    const pyro = await createDepartment(db, ownerActor, {
      showId: show.id,
      code: 'PYRO',
      name: 'Pyrotechnics',
      colour: '#FF0000',
    })
    expect(pyro).toMatchObject({ code: 'PYRO', name: 'Pyrotechnics', numberFormat: 'decimal' })
    const renamed = await updateDepartment(db, ownerActor, {
      departmentId: pyro.id,
      patch: { name: 'Pyro and SFX', colour: '#00FF00', numberFormat: 'point', hidden: true },
    })
    expect(renamed).toMatchObject({
      name: 'Pyro and SFX',
      colour: '#00FF00',
      numberFormat: 'point',
      hidden: true,
      updatedBy: ownerActor.userId,
    })
    expect(
      (await listDepartments(db, ownerActor, { showId: show.id })).find((d) => d.id === pyro.id),
    ).toMatchObject({ name: 'Pyro and SFX', hidden: true })

    const input = { showId: show.id, code: 'AV', name: 'AV', colour: '#123456' }
    expect(await code(createDepartment(db, editorActor, input))).toBe('forbidden')
    expect(await code(createDepartment(db, viewerActor, input))).toBe('forbidden')
    expect(await code(createDepartment(db, actorOf(outsider.id), input))).toBe('not_found')
    for (const a of [editorActor, viewerActor]) {
      expect(
        await code(updateDepartment(db, a, { departmentId: pyro.id, patch: { name: 'Nope' } })),
      ).toBe('forbidden')
    }
    expect(
      await code(
        updateDepartment(db, actorOf(outsider.id), { departmentId: pyro.id, patch: { name: 'x' } }),
      ),
    ).toBe('not_found')
    expect(
      await code(
        updateDepartment(db, ownerActor, { departmentId: 'missing', patch: { name: 'x' } }),
      ),
    ).toBe('not_found')
  })

  test('new departments sort after the existing ones; viewers can list', async () => {
    const { db, ownerActor, viewerActor, show } = await setup()
    const a = await createDepartment(db, ownerActor, {
      showId: show.id,
      code: 'AA',
      name: 'A',
      colour: '#111111',
    })
    const b = await createDepartment(db, ownerActor, {
      showId: show.id,
      code: 'BB',
      name: 'B',
      colour: '#222222',
      sortOrder: 5,
    })
    expect(a.sortOrder).toBe(70)
    expect(b.sortOrder).toBe(5)
    const listed = await listDepartments(db, viewerActor, { showId: show.id })
    expect(listed.map((d) => d.code)).toEqual([
      'LX',
      'BB',
      'SND',
      'TM',
      'VID',
      'SM',
      'STG',
      'FLY',
      'AA',
    ])
  })

  test('code is upper-cased, must match /^[A-Z][A-Z0-9]{0,7}$/, and is unique per show (conflict)', async () => {
    const { db, ownerActor, show } = await setup()
    const base = { showId: show.id, name: 'Name', colour: '#123456' }
    const made = await createDepartment(db, ownerActor, { ...base, code: ' pyro ' })
    expect(made.code).toBe('PYRO')
    expect(await code(createDepartment(db, ownerActor, { ...base, code: 'LX' }))).toBe('conflict')
    expect(await code(createDepartment(db, ownerActor, { ...base, code: 'lx' }))).toBe('conflict')
    for (const bad of ['9X', 'ABCDEFGHI', '', 'A B', 'A-B', 'A\u0000B']) {
      expect(await code(createDepartment(db, ownerActor, { ...base, code: bad })), bad).toBe(
        'invalid',
      )
    }
    expect((await createDepartment(db, ownerActor, { ...base, code: 'abcdefg1' })).code).toBe(
      'ABCDEFG1',
    )
    // Renaming the code applies the same rules.
    expect(
      await code(
        updateDepartment(db, ownerActor, { departmentId: made.id, patch: { code: 'SND' } }),
      ),
    ).toBe('conflict')
    expect(
      await code(updateDepartment(db, ownerActor, { departmentId: made.id, patch: { code: '1' } })),
    ).toBe('invalid')
    const moved = await updateDepartment(db, ownerActor, {
      departmentId: made.id,
      patch: { code: ' fx ' },
    })
    expect(moved.code).toBe('FX')
    // Keeping its own code is not a conflict.
    expect(
      (await updateDepartment(db, ownerActor, { departmentId: moved.id, patch: { code: 'FX' } }))
        .code,
    ).toBe('FX')
  })

  test('name is 1 to 60 characters without NUL, colour must be #RRGGBB, format and order are checked', async () => {
    const { db, ownerActor, show, byCode } = await setup()
    const base = { showId: show.id, code: 'ZZ', name: 'Name', colour: '#123456' }
    for (const colour of ['red', '#12345', '#1234567', 'ff0000', '#GGGGGG']) {
      expect(await code(createDepartment(db, ownerActor, { ...base, colour })), colour).toBe(
        'invalid',
      )
    }
    for (const name of ['', '   ', 'x'.repeat(61), 'a\u0000b']) {
      expect(
        await code(createDepartment(db, ownerActor, { ...base, name })),
        JSON.stringify(name),
      ).toBe('invalid')
    }
    expect(
      (await createDepartment(db, ownerActor, { ...base, name: 'x'.repeat(60) })).name,
    ).toHaveLength(60)
    const lx = byCode('LX')
    for (const patch of [
      { colour: 'blue' },
      { name: '' },
      { numberFormat: 'hex' as 'point' },
      { sortOrder: 1.5 },
      { sortOrder: 2 ** 40 },
      { hidden: 'yes' as unknown as boolean },
    ]) {
      expect(
        await code(updateDepartment(db, ownerActor, { departmentId: lx.id, patch })),
        JSON.stringify(patch),
      ).toBe('invalid')
    }
  })

  test('department changes are logged with layer department:<id>, and a no-op logs nothing', async () => {
    const { db, ownerActor, show, byCode } = await setup()
    const made = await createDepartment(db, ownerActor, {
      showId: show.id,
      code: 'PYRO',
      name: 'Pyro',
      colour: '#FF0000',
      batchId: 'batch-1',
    })
    await updateDepartment(db, ownerActor, {
      departmentId: made.id,
      patch: { name: 'Pyro 2', colour: '#FF0000', hidden: false },
      batchId: 'batch-2',
    })
    // Same values again: nothing to write.
    await updateDepartment(db, ownerActor, { departmentId: made.id, patch: { name: 'Pyro 2' } })
    const rows = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.tableName, 'departments'), eq(changeLog.rowId, made.id)))
      .orderBy(asc(changeLog.seq))
    expect(rows.map((r) => [r.op, r.batchId, r.layer])).toEqual([
      ['insert', 'batch-1', `department:${made.id}`],
      ['update', 'batch-2', `department:${made.id}`],
    ])
    expect(rows[0].after).toMatchObject({ code: 'PYRO', name: 'Pyro', colour: '#FF0000' })
    expect(rows[1].before).toEqual({ name: 'Pyro' })
    expect(rows[1].after).toEqual({ name: 'Pyro 2' })
    expect(rows[1]).toMatchObject({ userId: ownerActor.userId, via: 'web', showId: show.id })
    // The seeded rows are untouched.
    const lx = byCode('LX')
    expect(lx.updatedBy).toBe(ownerActor.userId)
  })

  test('departments are read-only on an archived show', async () => {
    const { db, ownerActor, show, byCode } = await setup()
    await updateShow(db, ownerActor, { showId: show.id, patch: { status: 'archived' } })
    expect(
      await code(
        createDepartment(db, ownerActor, {
          showId: show.id,
          code: 'X',
          name: 'X',
          colour: '#000000',
        }),
      ),
    ).toBe('forbidden')
    expect(
      await code(
        updateDepartment(db, ownerActor, {
          departmentId: byCode('LX').id,
          patch: { hidden: true },
        }),
      ),
    ).toBe('forbidden')
    // Reading still works.
    expect(await listDepartments(db, ownerActor, { showId: show.id })).toHaveLength(7)
  })
})

describe('membership scope', () => {
  test('updateShowMember scopes an editor; ids from another show are invalid; the last owner cannot be demoted; an archived show refuses it', async () => {
    const { db, ownerActor, editorActor, show, owner, editor, byCode, membershipOf } = await setup()
    const [org] = await listOrganisations(db, ownerActor)
    const other = await createShow(db, ownerActor, { organisationId: org.id, title: 'Other' })
    const otherLx = (await listDepartments(db, ownerActor, { showId: other.id }))[0]

    const scoped = await updateShowMember(db, ownerActor, {
      membershipId: membershipOf(editor.id),
      departments: [byCode('LX').id, byCode('SND').id],
      batchId: 'b1',
    })
    expect(scoped.departments).toEqual([byCode('LX').id, byCode('SND').id])
    expect(scoped.updatedBy).toBe(owner.id)
    expect(await getMembershipScope(db, editorActor, show.id)).toEqual({
      role: 'editor',
      departments: [byCode('LX').id, byCode('SND').id],
    })

    for (const departments of [
      [otherLx.id],
      [byCode('LX').id, otherLx.id],
      [],
      ['nope'],
      ['*', byCode('LX').id],
    ]) {
      expect(
        await code(
          updateShowMember(db, ownerActor, { membershipId: membershipOf(editor.id), departments }),
        ),
        JSON.stringify(departments),
      ).toBe('invalid')
    }
    // Scope can go back to everything.
    expect(
      (
        await updateShowMember(db, ownerActor, {
          membershipId: membershipOf(editor.id),
          departments: ['*'],
        })
      ).departments,
    ).toEqual(['*'])

    const [log] = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.tableName, 'show_memberships'), eq(changeLog.batchId, 'b1')))
    expect(log).toMatchObject({ op: 'update', rowId: membershipOf(editor.id), layer: null })
    expect(log.before).toEqual({ departments: ['*'] })
    expect(log.after).toEqual({ departments: [byCode('LX').id, byCode('SND').id] })

    // Only owners; an editor cannot widen their own scope.
    expect(
      await code(
        updateShowMember(db, editorActor, { membershipId: membershipOf(editor.id), role: 'owner' }),
      ),
    ).toBe('forbidden')

    // The last owner cannot be demoted; with a second owner they can.
    expect(
      await code(
        updateShowMember(db, ownerActor, { membershipId: membershipOf(owner.id), role: 'editor' }),
      ),
    ).toBe('conflict')
    await updateShowMember(db, ownerActor, { membershipId: membershipOf(editor.id), role: 'owner' })
    expect(
      (
        await updateShowMember(db, ownerActor, {
          membershipId: membershipOf(owner.id),
          role: 'editor',
        })
      ).role,
    ).toBe('editor')
    expect(
      await code(
        updateShowMember(db, editorActor, { membershipId: membershipOf(owner.id), role: 'owner' }),
      ),
    ).toBe('ok')
    // A membership of another show is invisible to this show's owner.
    const [foreign] = await db
      .select()
      .from(showMemberships)
      .where(eq(showMemberships.showId, other.id))
    expect(
      await code(
        updateShowMember(db, actorOf(editor.id), { membershipId: foreign.id, role: 'viewer' }),
      ),
    ).toBe('not_found')
    expect(
      await code(updateShowMember(db, ownerActor, { membershipId: 'missing', role: 'viewer' })),
    ).toBe('not_found')

    await updateShow(db, editorActor, { showId: show.id, patch: { status: 'archived' } })
    expect(
      await code(
        updateShowMember(db, editorActor, {
          membershipId: membershipOf(owner.id),
          departments: ['*'],
        }),
      ),
    ).toBe('forbidden')
  })

  test('updateShowMember with no change writes no log row', async () => {
    const { db, ownerActor, editor, membershipOf } = await setup()
    const before = await db.select().from(changeLog)
    await updateShowMember(db, ownerActor, {
      membershipId: membershipOf(editor.id),
      role: 'editor',
      departments: ['*'],
    })
    expect(await db.select().from(changeLog)).toHaveLength(before.length)
  })

  test('removeShowMember is owner-only, logged, keeps one owner, and refuses archived shows', async () => {
    const { db, ownerActor, editorActor, show, owner, viewer, editor, membershipOf } = await setup()
    const viewerMembership = membershipOf(viewer.id)
    expect(await code(removeShowMember(db, editorActor, { membershipId: viewerMembership }))).toBe(
      'forbidden',
    )
    expect(
      await code(removeShowMember(db, ownerActor, { membershipId: membershipOf(owner.id) })),
    ).toBe('conflict')
    expect(await code(removeShowMember(db, ownerActor, { membershipId: 'missing' }))).toBe(
      'not_found',
    )

    const removed = await removeShowMember(db, ownerActor, {
      membershipId: viewerMembership,
      batchId: 'rm',
    })
    expect(removed).toMatchObject({ id: viewerMembership, userId: viewer.id, role: 'viewer' })
    const members = await listShowMembers(db, ownerActor, { showId: show.id })
    expect(members.map((m) => m.userId).sort()).toEqual([editor.id, owner.id].sort())
    const [log] = await db.select().from(changeLog).where(eq(changeLog.batchId, 'rm'))
    expect(log).toMatchObject({
      tableName: 'show_memberships',
      op: 'delete',
      rowId: viewerMembership,
      after: null,
      layer: null,
    })
    expect(log.before).toEqual({ userId: viewer.id, role: 'viewer', departments: ['*'] })
    // The removed user no longer reaches the show.
    expect(await code(listDepartments(db, actorOf(viewer.id), { showId: show.id }))).toBe(
      'not_found',
    )

    await updateShow(db, ownerActor, { showId: show.id, patch: { status: 'archived' } })
    expect(
      await code(removeShowMember(db, ownerActor, { membershipId: membershipOf(editor.id) })),
    ).toBe('forbidden')
  })

  test('addShowMember rejects department ids from another show, and email with NUL', async () => {
    const { db, ownerActor, show, byCode } = await setup()
    const [org] = await listOrganisations(db, ownerActor)
    const other = await createShow(db, ownerActor, { organisationId: org.id, title: 'Other' })
    const otherLx = (await listDepartments(db, ownerActor, { showId: other.id }))[0]
    expect(
      await code(
        addShowMember(db, ownerActor, {
          showId: show.id,
          email: 'nobody@doc.test',
          role: 'editor',
          departments: [otherLx.id],
        }),
      ),
    ).toBe('invalid')
    expect(
      await code(
        addShowMember(db, ownerActor, {
          showId: show.id,
          email: 'a\u0000b@doc.test',
          role: 'editor',
        }),
      ),
    ).toBe('invalid')
    // Validation runs before the user lookup, so a valid scope on an unknown email is a not_found.
    expect(
      await code(
        addShowMember(db, ownerActor, {
          showId: show.id,
          email: 'nobody@doc.test',
          role: 'editor',
          departments: [byCode('LX').id],
        }),
      ),
    ).toBe('not_found')
  })

  test('listShowMembers shows emails to owners only', async () => {
    const {
      db,
      ownerActor,
      viewerActor,
      editorActor,
      show,
      owner,
      editor,
      viewer,
      byCode,
      membershipOf,
    } = await setup()
    await updateShowMember(db, ownerActor, {
      membershipId: membershipOf(editor.id),
      departments: [byCode('LX').id],
    })
    const asOwner = await listShowMembers(db, ownerActor, { showId: show.id })
    expect(asOwner.map((m) => [m.name, m.role, m.email !== null])).toEqual([
      ['Olive', 'owner', true],
      ['Ed', 'editor', true],
      ['Vi', 'viewer', true],
    ])
    for (const a of [viewerActor, editorActor]) {
      const rows = await listShowMembers(db, a, { showId: show.id })
      expect(rows.every((m) => m.email === null)).toBe(true)
      expect(rows.find((m) => m.userId === editor.id)).toMatchObject({
        name: 'Ed',
        role: 'editor',
        departments: [byCode('LX').id],
      })
    }
    expect(asOwner.find((m) => m.userId === owner.id)?.departments).toEqual(['*'])
    expect(asOwner.find((m) => m.userId === viewer.id)?.membershipId).toBe(membershipOf(viewer.id))
  })
})

describe('layer permissions', () => {
  test('requireLayerEdit enforces the matrix, hides other personal layers, and refuses archived shows', async () => {
    const {
      db,
      ownerActor,
      editorActor,
      viewerActor,
      show,
      owner,
      editor,
      viewer,
      byCode,
      membershipOf,
    } = await setup()
    await updateShowMember(db, ownerActor, {
      membershipId: membershipOf(editor.id),
      departments: [byCode('LX').id],
    })
    const dept = (c: string) => ({ kind: 'department', id: byCode(c).id }) as const
    const personal = (id: string) => ({ kind: 'personal', id }) as const
    const edit = (a: Actor, layer: Parameters<typeof requireLayerEdit>[3]) =>
      code(requireLayerEdit(db, a, show.id, layer))

    // Editor scoped to LX.
    expect(await edit(editorActor, dept('LX'))).toBe('ok')
    expect(await edit(editorActor, dept('SND'))).toBe('forbidden')
    expect(await edit(editorActor, personal(editor.id))).toBe('ok')
    expect(await edit(editorActor, personal(owner.id))).toBe('not_found')
    // Viewer: department layers are read-only, own personal layer is editable.
    expect(await edit(viewerActor, dept('LX'))).toBe('forbidden')
    expect(await edit(viewerActor, personal(viewer.id))).toBe('ok')
    expect(await edit(viewerActor, personal(editor.id))).toBe('not_found')
    // Owner edits every department layer, and still cannot reach another user's personal layer.
    expect(await edit(ownerActor, dept('FLY'))).toBe('ok')
    expect(await edit(ownerActor, personal(editor.id))).toBe('not_found')
    // A department that is not in this show is invalid, not forbidden.
    expect(await edit(ownerActor, { kind: 'department', id: 'not-a-department' })).toBe('invalid')
    // Non-members never learn the show exists.
    expect(await code(requireLayerEdit(db, actorOf('stranger'), show.id, dept('LX')))).toBe(
      'not_found',
    )

    await updateShow(db, ownerActor, { showId: show.id, patch: { status: 'archived' } })
    expect(await edit(ownerActor, dept('LX'))).toBe('forbidden')
    expect(await edit(editorActor, personal(editor.id))).toBe('forbidden')
  })

  test('a token scoped to another show cannot read the membership scope', async () => {
    const { db, ownerActor, show } = await setup()
    expect(
      await code(
        getMembershipScope(db, { ...ownerActor, showScope: ['some-other-show'] }, show.id),
      ),
    ).toBe('forbidden')
  })
})

describe('HTTP', () => {
  const json = (cookie: string, method: string, body?: unknown) => ({
    method,
    headers: { cookie, origin: APP_ORIGIN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  test('owner lists, creates and renames departments; PATCH as editor is 403', async () => {
    const { app, owner, editor, viewer, show } = await setup()
    const list = asJson(
      await app.request(`/api/shows/${show.id}/departments`, {
        headers: { cookie: viewer.cookie },
      }),
    )
    expect(list.status).toBe(200)
    expect((await list.json()).departments.map((d: { code: string }) => d.code)).toEqual([
      'LX',
      'SND',
      'TM',
      'VID',
      'SM',
      'STG',
      'FLY',
    ])

    const created = asJson(
      await app.request(
        `/api/shows/${show.id}/departments`,
        json(owner.cookie, 'POST', { code: 'pyro', name: 'Pyro', colour: '#FF0000' }),
      ),
    )
    expect(created.status).toBe(201)
    const dept = (await created.json()).department
    expect(dept).toMatchObject({ code: 'PYRO', numberFormat: 'decimal' })

    const dup = asJson(
      await app.request(
        `/api/shows/${show.id}/departments`,
        json(owner.cookie, 'POST', { code: 'LX', name: 'Dup', colour: '#FF0000' }),
      ),
    )
    expect(dup.status).toBe(409)
    const bad = asJson(
      await app.request(
        `/api/shows/${show.id}/departments`,
        json(owner.cookie, 'POST', { code: 'OK', name: 'a\u0000b', colour: '#FF0000' }),
      ),
    )
    expect(bad.status).toBe(400)
    const badColour = asJson(
      await app.request(
        `/api/shows/${show.id}/departments`,
        json(owner.cookie, 'POST', { code: 'OK', name: 'Fine', colour: 'red' }),
      ),
    )
    expect(badColour.status).toBe(400)

    const asEditor = asJson(
      await app.request(
        `/api/departments/${dept.id}`,
        json(editor.cookie, 'PATCH', { name: 'Nope' }),
      ),
    )
    expect(asEditor.status).toBe(403)
    const asOwner = asJson(
      await app.request(
        `/api/departments/${dept.id}`,
        json(owner.cookie, 'PATCH', { name: 'Pyro 2', hidden: true }),
      ),
    )
    expect(asOwner.status).toBe(200)
    expect((await asOwner.json()).department).toMatchObject({ name: 'Pyro 2', hidden: true })
    const empty = asJson(
      await app.request(`/api/departments/${dept.id}`, json(owner.cookie, 'PATCH', {})),
    )
    expect(empty.status).toBe(400)
    // Cookie writes need Origin, like every other route.
    const noOrigin = await app.request(`/api/departments/${dept.id}`, {
      method: 'PATCH',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(noOrigin.status).toBe(403)
  })

  test('GET members lists names and departments with email null for a viewer, emails for an owner', async () => {
    const { app, owner, viewer, show, editor } = await setup()
    const asViewer = asJson(
      await app.request(`/api/shows/${show.id}/members`, { headers: { cookie: viewer.cookie } }),
    )
    expect(asViewer.status).toBe(200)
    const viewerRows = (await asViewer.json()).members
    expect(viewerRows.map((m: { name: string }) => m.name)).toEqual(['Olive', 'Ed', 'Vi'])
    expect(
      viewerRows.every(
        (m: { email: unknown; departments: string[] }) =>
          m.email === null && m.departments[0] === '*',
      ),
    ).toBe(true)
    const asOwner = asJson(
      await app.request(`/api/shows/${show.id}/members`, { headers: { cookie: owner.cookie } }),
    )
    const ownerRows = (await asOwner.json()).members
    expect(ownerRows.every((m: { email: string | null }) => typeof m.email === 'string')).toBe(true)
    expect(ownerRows.find((m: { userId: string }) => m.userId === editor.id).email).toMatch(
      /^e\d+@doc\.test$/,
    )
  })

  test('PATCH and DELETE /api/memberships/:id are owner-only and validate departments', async () => {
    const { app, owner, editor, viewer, show, byCode, membershipOf } = await setup()
    const id = membershipOf(editor.id)
    const lx = byCode('LX').id
    const asEditor = await app.request(
      `/api/memberships/${id}`,
      json(editor.cookie, 'PATCH', { role: 'owner' }),
    )
    expect(asEditor.status).toBe(403)
    const bad = await app.request(
      `/api/memberships/${id}`,
      json(owner.cookie, 'PATCH', { departments: ['bogus'] }),
    )
    expect(bad.status).toBe(400)
    const nul = await app.request(
      `/api/memberships/${id}`,
      json(owner.cookie, 'PATCH', { departments: ['a\u0000b'] }),
    )
    expect(nul.status).toBe(400)
    const none = await app.request(`/api/memberships/${id}`, json(owner.cookie, 'PATCH', {}))
    expect(none.status).toBe(400)
    const ok = asJson(
      await app.request(
        `/api/memberships/${id}`,
        json(owner.cookie, 'PATCH', { departments: [lx] }),
      ),
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).membership.departments).toEqual([lx])

    const del = await app.request(
      `/api/memberships/${membershipOf(viewer.id)}`,
      json(owner.cookie, 'DELETE'),
    )
    expect(del.status).toBe(200)
    const gone = await app.request(`/api/shows/${show.id}/members`, {
      headers: { cookie: viewer.cookie },
    })
    expect(gone.status).toBe(404)
  })

  test('POST /api/shows/:id/members rejects NUL and overlong input, and unknown department ids', async () => {
    const { app, owner, show } = await setup()
    for (const body of [
      { email: 'a\u0000b@doc.test', role: 'viewer' },
      { email: `${'a'.repeat(250)}@doc.test`, role: 'viewer' },
      { email: 'x@doc.test', role: 'viewer', departments: ['a\u0000b'] },
      { email: 'x@doc.test', role: 'viewer', departments: [] },
    ]) {
      const res = await app.request(
        `/api/shows/${show.id}/members`,
        json(owner.cookie, 'POST', body),
      )
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400)
    }
    const unknown = await app.request(
      `/api/shows/${show.id}/members`,
      json(owner.cookie, 'POST', { email: 'x@doc.test', role: 'viewer', departments: ['bogus'] }),
    )
    expect(unknown.status).toBe(400)
  })
})
