import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { parse } from 'yaml'
import { SYNCED_TABLES } from '../src'
import { getTestDb } from './helpers'

const SYNC_CONFIG = join(__dirname, '../../../deploy/powersync/sync-config.yaml')

test('the powersync publication covers exactly SYNCED_TABLES', async () => {
  const { db } = await getTestDb()
  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync' ORDER BY tablename`,
  )
  expect(rows.map((r) => r.tablename)).toEqual([...SYNCED_TABLES].sort())
})

test('powersync_role can read exactly SYNCED_TABLES when the role exists', async () => {
  const { db } = await getTestDb()
  const role = await db.execute(sql`SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role'`)
  if (role.rows.length === 0) return // the per-file databases of a cluster without the role skip the grant
  const { rows } = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'powersync_role' AND privilege_type = 'SELECT' AND table_schema = 'public'
        ORDER BY table_name`,
  )
  expect(rows.map((r) => r.table_name)).toEqual([...SYNCED_TABLES].sort())
})

test('sync-config streams each synced table, and only those', () => {
  const config = parse(readFileSync(SYNC_CONFIG, 'utf8')) as {
    streams: Record<string, { queries: string[] }>
  }
  const streamed = Object.values(config.streams)
    .flatMap((s) => s.queries)
    .map((q) => /\bFROM\s+([a-z_]+)/i.exec(q)?.[1])
  expect(streamed.every((t) => t !== undefined)).toBe(true)
  expect([...new Set(streamed)].sort()).toEqual([...SYNCED_TABLES].sort())
})

test('sync-config streams personal annotations only where layer_id = auth.user_id()', () => {
  const config = parse(readFileSync(SYNC_CONFIG, 'utf8')) as {
    streams: Record<string, { queries: string[] }>
  }
  const queries = Object.values(config.streams)
    .flatMap((s) => s.queries)
    .filter((q) => /\bFROM\s+annotations\b/i.test(q))
    .map((q) => q.replace(/\s+/g, ' ').trim())
  // Every annotations query is either department-only or the owner's own personal layer.
  expect(queries.length).toBeGreaterThanOrEqual(1)
  for (const q of queries) {
    const departmentOnly = /\blayer_kind = 'department'/.test(q) && !/personal/.test(q)
    const ownPersonal =
      /\blayer_kind = 'personal' AND layer_id = auth\.user_id\(\)/.test(q) && !/department/.test(q)
    expect(departmentOnly || ownPersonal, `unsafe annotations query: ${q}`).toBe(true)
  }
  // Both layers are streamed, and no query leaves the layer open.
  expect(queries.some((q) => /layer_kind = 'department'/.test(q))).toBe(true)
  expect(queries.some((q) => /layer_id = auth\.user_id\(\)/.test(q))).toBe(true)
  // Every query still scopes to the user's shows.
  for (const q of queries) expect(q).toMatch(/show_id IN user_shows/)
})

test("sync-config streams export records as shared (private_to IS NULL) or the exporter's own only", () => {
  const config = parse(readFileSync(SYNC_CONFIG, 'utf8')) as {
    streams: Record<string, { queries: string[] }>
  }
  const queries = Object.values(config.streams)
    .flatMap((s) => s.queries)
    .filter((q) => /\bFROM\s+export_records\b/i.test(q))
    .map((q) => q.replace(/\s+/g, ' ').trim())
  expect(queries.length).toBe(2)
  for (const q of queries) {
    expect(q, `unsafe export_records query: ${q}`).toMatch(
      /private_to IS NULL$|private_to = auth\.user_id\(\)$/,
    )
    expect(q).toMatch(/show_id IN user_shows/)
  }
  expect(queries.some((q) => /private_to IS NULL/.test(q))).toBe(true)
  expect(queries.some((q) => /private_to = auth\.user_id\(\)/.test(q))).toBe(true)
})
