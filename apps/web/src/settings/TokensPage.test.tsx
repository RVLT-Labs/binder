import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { TokensPage } from './TokensPage'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))
vi.mock('../api/client', () => ({ api }))

const NOW = new Date().toISOString()
const record = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  showScope: '*',
  createdAt: NOW,
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...extra,
})

let tokens: ReturnType<typeof record>[]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TokensPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  tokens = [record('t1', 'Laptop'), record('t2', 'iPad')]
  api.get.mockImplementation(async () => ({ tokens }))
  api.post.mockImplementation(async (_path: string, body: { name: string }) => {
    const created = record('t3', body.name)
    tokens = [created, ...tokens]
    return { token: 'bndr_secret_value', record: created }
  })
  api.del.mockResolvedValue({})
})

test('a created token is shown once, in a red-outlined card with a Copy button', async () => {
  renderPage()
  await screen.findByText('Laptop')
  fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Claude Code' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
  const card = await screen.findByRole('status')
  expect(card.className).toContain('border-red')
  expect(within(card).getByText('Copy it now. Binder will not show it again.')).toBeTruthy()
  expect((within(card).getByLabelText('New token') as HTMLInputElement).value).toBe(
    'bndr_secret_value',
  )
  expect(within(card).getByRole('button', { name: 'Copy' })).toBeTruthy()
  expect(within(card).getByText(/Token “Claude Code”, created just now\./)).toBeTruthy()
  expect((screen.getByLabelText('Token name') as HTMLInputElement).value).toBe('')
})

test('Copy puts the token on the clipboard', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderPage()
  await screen.findByText('Laptop')
  fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Claude Code' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('bndr_secret_value'))
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
})

test('Revoke asks inline first, and Keep leaves the token alone', async () => {
  renderPage()
  await screen.findByText('iPad')
  fireEvent.click(screen.getByRole('button', { name: 'Revoke iPad' }))
  const ask = screen.getByText('Revoke “iPad”? Anything using it stops working.')
  const row = ask.closest('li') as HTMLElement
  expect(within(row).getByRole('button', { name: 'Revoke' })).toBeTruthy()
  fireEvent.click(within(row).getByRole('button', { name: 'Keep' }))
  expect(screen.queryByText('Revoke “iPad”? Anything using it stops working.')).toBeNull()
  expect(api.del).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Revoke iPad' })).toBeTruthy()
})

test('confirming revokes it', async () => {
  renderPage()
  await screen.findByText('iPad')
  fireEvent.click(screen.getByRole('button', { name: 'Revoke iPad' }))
  const row = screen
    .getByText('Revoke “iPad”? Anything using it stops working.')
    .closest('li') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledWith('/me/tokens/t2'))
})

test('a token that was never used says so; a revoked one is marked and has no Revoke', async () => {
  tokens = [record('t1', 'Laptop'), record('t2', 'Old', { revokedAt: NOW })]
  renderPage()
  await screen.findByText('Laptop')
  expect(screen.getAllByText('never used').length).toBeGreaterThan(0)
  expect(screen.getByText('Revoked')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Revoke Old' })).toBeNull()
})

test('with no tokens the list says so, and says nothing while there are some', async () => {
  tokens = []
  const { unmount } = renderPage()
  expect(await screen.findByText('No tokens yet. Name one above and create it.')).toBeTruthy()
  unmount()
  tokens = [record('t1', 'Laptop')]
  renderPage()
  await screen.findByText('Laptop')
  expect(screen.queryByText(/No tokens yet/)).toBeNull()
})
