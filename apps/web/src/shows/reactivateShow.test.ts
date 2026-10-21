import { expect, test, vi } from 'vitest'
import { REACTIVATED_STATUS, reactivateShow } from './reactivateShow'

test('a reactivated show goes back to prep, through one local show update', async () => {
  const db = { execute: vi.fn(async () => ({ rowsAffected: 1 })) }
  await reactivateShow(db as never, 's1')
  expect(REACTIVATED_STATUS).toBe('prep')
  expect(db.execute).toHaveBeenCalledTimes(1)
  expect(db.execute).toHaveBeenCalledWith('UPDATE shows SET status = ? WHERE id = ?', [
    'prep',
    's1',
  ])
})

test('a failed write is the caller’s to report', async () => {
  const db = {
    execute: vi.fn(async () => {
      throw new Error('locked')
    }),
  }
  await expect(reactivateShow(db as never, 's1')).rejects.toThrow('locked')
})
