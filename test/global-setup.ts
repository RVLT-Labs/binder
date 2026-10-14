import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { TestProject } from 'vitest/node'
import { ensureFixtures } from '../fixtures/scripts/make-fixtures.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string
  }
}

/**
 * Starts one Postgres container per test run. Test files never share a database: getTestDb()
 * (packages/db/test/helpers.ts) creates a fresh database inside this container per test file.
 */
export default async function setup(project: TestProject) {
  // Generate public fixtures once, in this single process, before any worker reads them.
  await ensureFixtures()
  const container = await new PostgreSqlContainer('postgres:17').start()
  const url = container.getConnectionUri()
  project.provide('dbUrl', url)
  // Fallback for child projects: see getTestDb().
  process.env.TEST_DATABASE_URL = url
  return async () => {
    await container.stop()
  }
}
