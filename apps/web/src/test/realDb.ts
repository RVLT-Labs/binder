/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite'
import { AppSchema } from '../powersync/schema'

/** The PowerSync client schema's tables, created in a real SQLite, behind the db surface mutations use. */
export function realDb() {
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
