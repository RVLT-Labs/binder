import { newId } from '@binder/shared'
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
