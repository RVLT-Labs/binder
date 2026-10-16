import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId } from '@binder/shared'
import { sql } from 'drizzle-orm'
import { beforeEach, expect, test } from 'vitest'
import {
  documents,
  documentVersions,
  organisations,
  pages,
  personalAccessTokens,
  showMemberships,
  shows,
} from '../src/schema'
import { getTestDb } from './helpers'

beforeEach(async () => {
  const { truncateAll } = await getTestDb()
  await truncateAll()
})

test('migrations apply and a show with a membership round-trips', async () => {
  const { db } = await getTestDb()
  const orgId = newId()
  const showId = newId()
  await db.insert(organisations).values({ id: orgId, name: 'TTP' })
  await db
    .insert(shows)
    .values({ id: showId, organisationId: orgId, title: 'Pirates', updatedBy: 'u1' })
  await db.insert(showMemberships).values({ id: newId(), showId, userId: 'u1', role: 'owner' })
  const rows = await db.select().from(shows)
  expect(rows[0]).toMatchObject({ title: 'Pirates', status: 'prep', settings: {} })
})

test('duplicate membership is rejected', async () => {
  const { db } = await getTestDb()
  const orgId = newId()
  const showId = newId()
  await db.insert(organisations).values({ id: orgId, name: 'TTP' })
  await db
    .insert(shows)
    .values({ id: showId, organisationId: orgId, title: 'Pirates', updatedBy: 'u1' })
  await db.insert(showMemberships).values({ id: newId(), showId, userId: 'u1', role: 'owner' })
  await expect(
    db.insert(showMemberships).values({ id: newId(), showId, userId: 'u1', role: 'editor' }),
  ).rejects.toThrow()
})

test('truncateAll empties tables', async () => {
  const { db, truncateAll } = await getTestDb()
  await db.insert(organisations).values({ id: newId(), name: 'TTP' })
  await truncateAll()
  expect(await db.select().from(organisations)).toHaveLength(0)
})

test('column defaults: membership departments and token scope', async () => {
  const { db } = await getTestDb()
  const orgId = newId()
  const showId = newId()
  await db.insert(organisations).values({ id: orgId, name: 'TTP' })
  await db
    .insert(shows)
    .values({ id: showId, organisationId: orgId, title: 'Pirates', updatedBy: 'u1' })
  await db.insert(showMemberships).values({ id: newId(), showId, userId: 'u1', role: 'viewer' })
  await db
    .insert(personalAccessTokens)
    .values({ id: newId(), userId: 'u1', name: 'cli', tokenHash: 'h1' })
  const [m] = await db.select().from(showMemberships)
  const [t] = await db.select().from(personalAccessTokens)
  expect(m?.departments).toEqual(['*'])
  expect(t?.showScope).toBe('*')
  expect(t?.revokedAt).toBeNull()
})

test('pages and document_versions get audit columns by default', async () => {
  const { db } = await getTestDb()
  const orgId = newId()
  const showId = newId()
  const docId = newId()
  const versionId = newId()
  await db.insert(organisations).values({ id: orgId, name: 'TTP' })
  await db
    .insert(shows)
    .values({ id: showId, organisationId: orgId, title: 'Pirates', updatedBy: 'u1' })
  await db
    .insert(documents)
    .values({ id: docId, showId, kind: 'libretto', title: 'Libretto', updatedBy: 'u1' })
  await db.insert(documentVersions).values({
    id: versionId,
    showId,
    documentId: docId,
    versionNumber: 1,
    originalKey: 'k',
    uploadedBy: 'u1',
  })
  await db.insert(pages).values({ id: newId(), showId, documentVersionId: versionId, index: 0 })
  const [v] = await db.select().from(documentVersions)
  const [p] = await db.select().from(pages)
  for (const row of [v, p]) {
    expect(row?.updatedBy).toBe('system')
    expect(row?.createdAt).toBeInstanceOf(Date)
    expect(row?.updatedAt).toBeInstanceOf(Date)
  }
})

test('the 0016 migration backfills failure codes from error', async () => {
  const { db } = await getTestDb()
  const orgId = newId()
  const showId = newId()
  const docId = newId()
  await db.insert(organisations).values({ id: orgId, name: 'TTP' })
  await db
    .insert(shows)
    .values({ id: showId, organisationId: orgId, title: 'Pirates', updatedBy: 'u1' })
  await db
    .insert(documents)
    .values({ id: docId, showId, kind: 'libretto', title: 'Libretto', updatedBy: 'u1' })
  const cases: Array<
    [status: 'failed' | 'ready' | 'queued', error: string | null, code: string | null]
  > = [
    [
      'failed',
      'This PDF is password-protected. Remove the password and upload it again.',
      'password_protected',
    ],
    ['failed', 'This file could not be read as a PDF. (pdfinfo exit 1)', 'unreadable'],
    ['failed', 'Processing timed out after retries.', 'timeout'],
    ['failed', 'Processing failed after retries: job timed out', 'timeout'],
    ['failed', 'Could not queue processing', 'enqueue_failed'],
    ['failed', 'Processing failed after retries: boom', 'unknown'],
    ['failed', null, 'unknown'],
    // Only failed rows are classified.
    ['ready', 'ocrmypdf exit 1: something', null],
    ['queued', null, null],
  ]
  const ids = cases.map(() => newId())
  await db.insert(documentVersions).values(
    cases.map(([status, error], i) => ({
      id: ids[i],
      showId,
      documentId: docId,
      versionNumber: i + 1,
      originalKey: `k${i}`,
      uploadedBy: 'u1',
      status,
      error,
    })),
  )

  const sqlText = readFileSync(
    join(import.meta.dirname, '../drizzle/0016_version_processing_controls.sql'),
    'utf8',
  )
  const backfill = sqlText
    .split('--> statement-breakpoint')
    .find((s) => s.trim().startsWith('UPDATE'))
  expect(backfill).toBeDefined()
  await db.execute(sql.raw(backfill as string))

  const rows = await db.select().from(documentVersions)
  for (const [i, [, , code]] of cases.entries()) {
    expect(rows.find((r) => r.id === ids[i])?.failureCode, `case ${i}`).toBe(code)
  }
  // The new columns exist and default to null.
  expect(rows.every((r) => r.originalSizeBytes === null && r.failureDpi === null)).toBe(true)
})
