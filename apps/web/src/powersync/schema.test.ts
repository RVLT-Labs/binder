import {
  annotations,
  cues,
  departments,
  documents,
  documentVersions,
  pages,
  showMemberships,
  shows,
} from '@binder/db/schema'
import { getTableColumns, getTableName, type Table } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { AppSchema } from './schema'

// Every table PowerSync streams (deploy/powersync/sync-config.yaml). Adding a column on one side
// without the other must fail here.
const SYNCED: Table[] = [
  shows,
  showMemberships,
  documents,
  documentVersions,
  pages,
  departments,
  cues,
  annotations,
]

test('the client schema lists exactly the synced tables', () => {
  expect(AppSchema.tables.map((t) => t.name).sort()).toEqual(SYNCED.map(getTableName).sort())
})

test.each(SYNCED.map((t) => [getTableName(t), t] as const))(
  '%s has the same columns on client and server',
  (name, table) => {
    const server = Object.values(getTableColumns(table))
      .map((c) => c.name)
      .filter((n) => n !== 'id')
      .sort()
    const client = AppSchema.tables
      .find((t) => t.name === name)
      ?.columns.map((c) => c.name)
      .sort()
    expect(client).toEqual(server)
  },
)
