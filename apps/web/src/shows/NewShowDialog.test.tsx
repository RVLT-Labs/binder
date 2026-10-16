import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import { installDialogPolyfill, pressEscapeIn } from '../test/dialog'
import { NewShowDialog } from './NewShowDialog'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../api/client', async (orig) => ({
  ...(await orig<typeof import('../api/client')>()),
  api,
}))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
const getOptional = vi.hoisted(() => vi.fn())
vi.mock('@powersync/react', () => ({ usePowerSync: () => ({ getOptional }) }))

beforeEach(() => {
  clearNotices()
  installDialogPolyfill()
  api.get.mockReset().mockResolvedValue({ organisations: [{ id: 'org1', name: 'Two Toned' }] })
  api.post.mockReset().mockResolvedValue({ show: { id: 'new-show', title: 'Little Women' } })
  getOptional.mockReset().mockResolvedValue({ id: 'new-show' })
  navigate.mockReset()
})

/** A page with the "New show" button that opens the dialog, as the shows home has. */
function Page() {
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <button type="button" onClick={(e) => setOpener(e.currentTarget)}>
        New show
      </button>
      {opener && <NewShowDialog returnFocusTo={opener} onClose={() => setOpener(null)} />}
    </QueryClientProvider>
  )
}

async function open() {
  render(<Page />)
  const button = screen.getByRole('button', { name: 'New show' })
  button.focus()
  fireEvent.click(button)
  const field = (await screen.findByLabelText('New show title')) as HTMLInputElement
  return { button, field }
}

test('creates the show in the first organisation and goes to it', async () => {
  const { field } = await open()
  fireEvent.change(field, { target: { value: '  Little Women  ' } })
  const create = screen.getByRole('button', { name: 'Create' })
  await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(create)
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({ to: '/shows/$showId', params: { showId: 'new-show' } }),
  )
  expect(api.post).toHaveBeenCalledWith('/orgs/org1/shows', { title: 'Little Women' })
})

test('Create waits for a title', async () => {
  await open()
  const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
  expect(create.disabled).toBe(true)
  expect(api.post).not.toHaveBeenCalled()
})

test('stays open and says why when the show cannot be created', async () => {
  api.post.mockRejectedValueOnce(new Error('Organisation not found'))
  const { field } = await open()
  fireEvent.change(field, { target: { value: 'Little Women' } })
  const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
  await waitFor(() => expect(create.disabled).toBe(false))
  fireEvent.click(create)
  await waitFor(() =>
    expect(getNotices().map((n) => n.message)).toEqual([
      'Could not create the show: Organisation not found',
    ]),
  )
  expect(navigate).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'New show' })).toBeTruthy()
})

test('Cancel closes the dialog and focus goes back to the New show button', async () => {
  const { button } = await open()
  expect(document.activeElement).not.toBe(button)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull())
  expect(document.activeElement).toBe(button)
})

test('Escape closes the dialog and focus goes back to the New show button', async () => {
  const { button } = await open()
  pressEscapeIn(screen.getByRole('dialog', { name: 'New show' }) as HTMLDialogElement)
  await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull())
  expect(document.activeElement).toBe(button)
})
