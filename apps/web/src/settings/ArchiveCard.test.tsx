import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { installDialogPolyfill } from '../test/dialog'
import { ArchiveCard } from './ArchiveCard'

let status = 'running'
const db = { execute: vi.fn(async (_sql: string, _params: unknown[]) => {}) }
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  useQuery: () => ({ data: [{ status, title: 'Songs for a New World' }] }),
}))

beforeEach(() => {
  installDialogPolyfill()
  vi.clearAllMocks()
  status = 'running'
})

test('archiving asks first, then writes the status through the local show update', async () => {
  render(<ArchiveCard showId="s1" />)
  expect(screen.getByText('Archive this show')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Archive show' }))
  expect(db.execute).not.toHaveBeenCalled()
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain('Songs for a New World')
  const confirm = Array.from(dialog.querySelectorAll('button')).find(
    (b) => b.textContent === 'Archive show',
  ) as HTMLButtonElement
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(db.execute).toHaveBeenCalledWith('UPDATE shows SET status = ? WHERE id = ?', [
      'archived',
      's1',
    ]),
  )
})

test('an archived show offers to unarchive, without asking', async () => {
  status = 'archived'
  render(<ArchiveCard showId="s1" />)
  expect(screen.getByText('This show is archived')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Unarchive show' }))
  await waitFor(() =>
    expect(db.execute).toHaveBeenCalledWith('UPDATE shows SET status = ? WHERE id = ?', [
      'prep',
      's1',
    ]),
  )
})
