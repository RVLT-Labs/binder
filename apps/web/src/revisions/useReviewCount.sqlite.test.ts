import { expect, test } from 'vitest'
import { realDb } from '../test/realDb'
import { REVIEW_COUNT_SQL, REVIEW_COUNTS_SQL } from './useReviewCount'

const anchor = (versionId: string, status: string, documentId = 'd1') =>
  JSON.stringify({ documentId, documentVersionId: versionId, pageIndex: 0, x: 1, y: 2, status })

interface Db {
  getAll(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>
  writeTransaction(
    fn: (tx: { execute(sql: string, params?: unknown[]): Promise<void> }) => Promise<void>,
  ): Promise<void>
}

async function seed(): Promise<{ db: Db }> {
  const h = realDb()
  const db = h.db as unknown as Db
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      "INSERT INTO documents (id, show_id, current_version_id) VALUES ('d1', 's1', 'v2')",
    )
    const cue = (id: string, a: string | null) =>
      tx.execute(
        "INSERT INTO cues (id, show_id, department_id, anchor) VALUES (?, 's1', 'lx', ?)",
        [id, a],
      )
    await cue('c-ok', anchor('v2', 'ok'))
    await cue('c-approx', anchor('v2', 'approximate'))
    await cue('c-unres', anchor('v2', 'unresolved'))
    await cue('c-old', anchor('v1', 'approximate'))
    await cue('c-unplaced', null)
    await cue('c-other-doc', anchor('v9', 'unresolved', 'd2'))
    const note = (id: string, kind: string, owner: string, a: string) =>
      tx.execute(
        "INSERT INTO annotations (id, show_id, layer_kind, layer_id, anchor) VALUES (?, 's1', ?, ?, ?)",
        [id, kind, owner, a],
      )
    await note('a-dept', 'department', 'lx', anchor('v2', 'approximate'))
    await note('a-mine', 'personal', 'me', anchor('v2', 'unresolved'))
    await note('a-theirs', 'personal', 'them', anchor('v2', 'unresolved'))
    await note('a-ok', 'department', 'lx', anchor('v2', 'ok'))
  })
  return { db }
}

test('counts the current version’s cues and annotations that are not ok', async () => {
  const { db } = await seed()
  const rows = await db.getAll(REVIEW_COUNT_SQL, ['me', 'd1'])
  // approx + unresolved cues, the department note, and my personal note; not their personal note.
  expect(rows[0]?.n).toBe(4)
})

test('counts nothing for a document with no current version, and falls as statuses become ok', async () => {
  const { db } = await seed()
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE cues SET anchor = json_set(anchor, '$.status', 'ok') WHERE id = 'c-approx'`,
    )
  })
  expect((await db.getAll(REVIEW_COUNT_SQL, ['me', 'd1']))[0]?.n).toBe(3)
  await db.writeTransaction(async (tx) => {
    await tx.execute("UPDATE documents SET current_version_id = NULL WHERE id = 'd1'")
  })
  expect((await db.getAll(REVIEW_COUNT_SQL, ['me', 'd1']))[0]?.n ?? 0).toBe(0)
})

test('counts the same items per document across a show, leaving out documents with no current version', async () => {
  const { db } = await seed()
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      "INSERT INTO documents (id, show_id, current_version_id) VALUES ('d3', 's1', NULL)",
    )
    await tx.execute(
      "INSERT INTO documents (id, show_id, current_version_id) VALUES ('d4', 's2', 'v4')",
    )
  })
  const rows = await db.getAll(REVIEW_COUNTS_SQL, ['me', 's1'])
  expect(rows.map((r) => [r.document_id, r.n])).toEqual([['d1', 4]])
})
