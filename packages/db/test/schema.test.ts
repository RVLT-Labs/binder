import { newId } from '@binder/shared'
import { beforeEach, expect, test } from 'vitest'
import { organisations, personalAccessTokens, showMemberships, shows } from '../src/schema'
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
