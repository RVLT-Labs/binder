import { sql } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { getTestDb } from './helpers'

test('the powersync publication covers exactly the five synced tables', async () => {
  const { db } = await getTestDb()
  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync' ORDER BY tablename`,
  )
  expect(rows.map((r) => r.tablename)).toEqual([
    'document_versions',
    'documents',
    'pages',
    'show_memberships',
    'shows',
  ])
})
