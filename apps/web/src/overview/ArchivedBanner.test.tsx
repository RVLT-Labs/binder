import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { ArchivedBanner } from './ArchivedBanner'

const db = { execute: vi.fn(async (_sql: string, _params: unknown[]) => ({})) }
vi.mock('@powersync/react', () => ({ usePowerSync: () => db }))

beforeEach(() => {
  vi.clearAllMocks()
})

test('says the show is archived and read-only, with exports still working', () => {
  render(<ArchivedBanner showId="s1" userRole="viewer" />)
  const banner = screen.getByRole('region', { name: 'Archived show' })
  expect(banner.textContent).toContain('This show is archived')
  expect(banner.textContent).toContain('Read-only for everyone')
  expect(banner.textContent).toContain('Exports still work')
})

test('an owner can reactivate the show: one local status write back to prep', async () => {
  render(<ArchivedBanner showId="s1" userRole="owner" />)
  expect(screen.getByRole('region').textContent).toContain('Reactivate it to edit again.')
  fireEvent.click(screen.getByRole('button', { name: 'Reactivate show' }))
  await waitFor(() =>
    expect(db.execute).toHaveBeenCalledWith('UPDATE shows SET status = ? WHERE id = ?', [
      'prep',
      's1',
    ]),
  )
  expect(db.execute).toHaveBeenCalledTimes(1)
})

test.each(['editor', 'viewer'])('a %s is told to ask an owner and gets no button', (role) => {
  render(<ArchivedBanner showId="s1" userRole={role} />)
  expect(screen.getByRole('region').textContent).toContain('Ask an owner to reactivate it.')
  expect(screen.queryByRole('button')).toBeNull()
})

test('before the membership has synced it neither offers the button nor guesses who to ask', () => {
  render(<ArchivedBanner showId="s1" userRole={null} />)
  const text = screen.getByRole('region').textContent ?? ''
  expect(screen.queryByRole('button')).toBeNull()
  expect(text).not.toContain('Ask an owner')
  expect(text).not.toContain('Reactivate it')
})

test('a write that fails is reported in the banner', async () => {
  db.execute.mockRejectedValueOnce(new Error('database is locked'))
  render(<ArchivedBanner showId="s1" userRole="owner" />)
  fireEvent.click(screen.getByRole('button', { name: 'Reactivate show' }))
  expect((await screen.findByRole('alert')).textContent).toBe('database is locked')
})
