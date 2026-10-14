import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'
import { createDb, type Db, runMigrations } from '../src'

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string
  }
}

export interface TestDb {
  db: Db
  /** Connection string of this file's database, for clients that open their own pool (pg-boss). */
  url: string
  truncateAll(): Promise<void>
}

let cached: Promise<TestDb> | undefined

function adminUrl(): string {
  const url = inject('dbUrl') ?? process.env.TEST_DATABASE_URL
  if (!url) throw new Error('No test database: the global setup did not provide dbUrl')
  return url
}

async function create(): Promise<TestDb> {
  const admin = adminUrl()
  // Each test file gets its own database so files running in parallel never see each other's rows.
  const name = `t_${randomBytes(8).toString('hex')}`
  const adminPool = new pg.Pool({ connectionString: admin, max: 1 })
  try {
    await adminPool.query(`CREATE DATABASE ${name}`)
  } finally {
    await adminPool.end()
  }
  const url = new URL(admin)
  url.pathname = `/${name}`
  const { db, pool } = createDb(url.toString())
  await runMigrations(db)
  return {
    db,
    url: url.toString(),
    async truncateAll() {
      const { rows } = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      )
      if (rows.length === 0) return
      const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ')
      await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`)
    },
  }
}

/** A migrated, isolated database for the calling test file. Cached for the rest of that module. */
export function getTestDb(): Promise<TestDb> {
  cached ??= create()
  return cached
}
