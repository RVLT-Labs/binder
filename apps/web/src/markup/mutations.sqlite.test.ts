/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite'
import type { Anchor, CueFields } from '@binder/shared'
import { afterAll, afterEach, expect, test } from 'vitest'
import { AppSchema } from '../powersync/schema'
import {
  deleteCue,
  insertCue,
  type LocalEdit,
  subscribeLocalEdits,
  updateCue,
  updateCues,
} from './mutations'

/** The PowerSync client schema's tables, created in a real SQLite, behind the db surface mutations use. */
function realDb() {
  const sqlite = new DatabaseSync(':memory:')
  for (const t of AppSchema.tables) {
    const cols = ['id TEXT PRIMARY KEY', ...t.columns.map((c) => `"${c.name}" ${c.type ?? 'TEXT'}`)]
    sqlite.exec(`CREATE TABLE ${t.name} (${cols.join(', ')})`)
  }
  const tx = {
    async execute(sql: string, params: unknown[] = []) {
      sqlite.prepare(sql).run(...(params as never[]))
    },
    async getOptional(sql: string, params: unknown[] = []) {
      return (sqlite.prepare(sql).get(...(params as never[])) as Record<string, unknown>) ?? null
    },
  }
  const db = {
    async writeTransaction<T>(fn: (t: typeof tx) => Promise<T>): Promise<T> {
      sqlite.exec('BEGIN')
      try {
        const out = await fn(tx)
        sqlite.exec('COMMIT')
        return out
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
  }
  const all = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>
  return { db: db as never, all }
}

const anchor: Anchor = {
  documentId: 'd',
  documentVersionId: 'v',
  pageIndex: 0,
  x: 10,
  y: 20,
  status: 'ok',
}
const fields: CueFields = {
  departmentId: 'lx',
  major: 10,
  minor: 0,
  label: 'Go',
  type: 'go',
  notes: '',
  colour: null,
  anchor,
}
const ctx = { showId: 's1', userId: 'u1', scope: { role: 'owner' as const, departments: ['*'] } }

let groups: LocalEdit[][] = []
const off = subscribeLocalEdits((edits) => groups.push(edits))
afterEach(() => {
  groups = []
})
afterAll(off)

test('insert, update, batch update and delete run as real SQL against the client schema', async () => {
  const { db, all } = realDb()
  const a = await insertCue(db, ctx, fields)
  const b = await insertCue(db, ctx, { ...fields, major: 11, anchor: null })
  let rows = all('SELECT * FROM cues ORDER BY major')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({
    id: a,
    show_id: 's1',
    department_id: 'lx',
    major: 10,
    updated_by: 'u1',
    payload: '{}',
  })
  expect(JSON.parse(rows[0]?.anchor as string)).toEqual(anchor)
  expect(rows[1]?.anchor).toBeNull()
  expect(groups.map((g) => g[0]?.op)).toEqual(['insert', 'insert'])
  expect(groups[0]?.[0]?.after).toEqual(rows[0])

  groups = []
  await updateCue(db, { ...ctx, userId: 'u2' }, a, {
    label: 'Go now',
    anchor: { ...anchor, y: 99 },
  })
  rows = all('SELECT * FROM cues ORDER BY major')
  expect(rows[0]).toMatchObject({
    label: 'Go now',
    updated_by: 'u2',
    created_at: expect.any(String),
  })
  expect(JSON.parse(rows[0]?.anchor as string).y).toBe(99)
  expect(groups).toHaveLength(1)
  expect(groups[0]?.[0]).toMatchObject({ op: 'update', id: a })
  expect(groups[0]?.[0]?.before?.label).toBe('Go')
  expect(groups[0]?.[0]?.after).toEqual(rows[0])

  groups = []
  await updateCues(db, ctx, [
    { id: a, patch: { minor: 5 } },
    { id: b, patch: { minor: 6, colour: '#FF0000' } },
  ])
  rows = all('SELECT * FROM cues ORDER BY major')
  expect(rows.map((r) => [r.minor, r.colour])).toEqual([
    [5, null],
    [6, '#FF0000'],
  ])
  expect(groups).toHaveLength(1)
  expect(groups[0]?.map((e) => e.id)).toEqual([a, b])

  groups = []
  await deleteCue(db, ctx, a)
  expect(all('SELECT id FROM cues')).toEqual([{ id: b }])
  expect(groups[0]?.[0]).toMatchObject({ op: 'delete', id: a, after: null })
  expect(groups[0]?.[0]?.before).toMatchObject({ id: a, label: 'Go now' })
})

test('a refused batch rolls back for real: no row changes', async () => {
  const { db, all } = realDb()
  const lx = await insertCue(db, ctx, fields)
  const snd = await insertCue(db, ctx, { ...fields, departmentId: 'snd' })
  const scoped = { ...ctx, scope: { role: 'editor' as const, departments: ['lx'] } }
  groups = []
  await expect(
    updateCues(db, scoped, [
      { id: lx, patch: { label: 'x' } },
      { id: snd, patch: { label: 'x' } },
    ]),
  ).rejects.toMatchObject({ code: 'forbidden' })
  expect(all('SELECT label FROM cues').map((r) => r.label)).toEqual(['Go', 'Go'])
  expect(groups).toEqual([])
})
