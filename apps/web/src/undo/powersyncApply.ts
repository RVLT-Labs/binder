import type { AbstractPowerSyncDatabase } from '@powersync/web'
import { emitLocalEdits, type LocalEdit, type MarkupTable } from '../markup/mutations'
import type { ApplyFns } from './undoStack'

type Row = Record<string, unknown>
type Tx = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>
type Db = { writeTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> } & Partial<
  Pick<AbstractPowerSyncDatabase, 'getOptional'>
>

/**
 * `ApplyFns` over the local PowerSync database. A group runs in one `writeTransaction`, which the
 * connector uploads in chunks; once it commits, its writes are announced as `undo` or `redo` edits
 * so they are never recorded as new user edits.
 */
export function powersyncApply(
  dbOrGet: Db | (() => Db),
  userOrGet: string | (() => string),
): ApplyFns {
  // Callers that outlive a component pass getters, so each write uses the current database and user.
  const getDb = () => (typeof dbOrGet === 'function' ? dbOrGet() : dbOrGet)
  const getUser = () => (typeof userOrGet === 'function' ? userOrGet() : userOrGet)
  let tx: Tx | null = null
  let edits: LocalEdit[] = []

  const reader = (): Pick<Tx, 'getOptional'> => {
    const d = getDb()
    const r = tx ?? (d.getOptional ? (d as Pick<Tx, 'getOptional'>) : null)
    if (!r) throw new Error('undo read outside a transaction')
    return r
  }
  const active = (): Tx => {
    if (!tx) throw new Error('undo write outside a transaction')
    return tx
  }
  const read = (table: MarkupTable, id: string) =>
    reader().getOptional<Row>(`SELECT * FROM ${table} WHERE id = ?`, [id])

  return {
    read,
    async insert(table, row) {
      const now = new Date().toISOString()
      const full: Row = { ...row, updated_at: now, updated_by: getUser() }
      const cols = Object.keys(full)
      await active().execute(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => full[c]),
      )
      edits.push({
        table,
        id: String(row.id),
        op: 'insert',
        before: null,
        after: await read(table, String(row.id)),
      })
    },
    async update(table, id, cols) {
      const before = await read(table, id)
      const sets: Array<[string, unknown]> = [
        ...Object.entries(cols),
        ['updated_at', new Date().toISOString()],
        ['updated_by', getUser()],
      ]
      await active().execute(
        `UPDATE ${table} SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...sets.map(([, v]) => v), id],
      )
      edits.push({ table, id, op: 'update', before, after: await read(table, id) })
    },
    async remove(table, id) {
      const before = await read(table, id)
      await active().execute(`DELETE FROM ${table} WHERE id = ?`, [id])
      edits.push({ table, id, op: 'delete', before, after: null })
    },
    async transaction(fn, source = 'undo') {
      edits = []
      try {
        await getDb().writeTransaction(async (t) => {
          tx = t
          try {
            await fn()
          } finally {
            tx = null
          }
        })
      } catch (e) {
        edits = []
        throw e
      }
      const done = edits
      edits = []
      emitLocalEdits(done, source)
    },
  }
}
