import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { DepartmentRow } from '../markup/useDepartments'
import { installDialogPolyfill } from '../test/dialog'
import { MembersSection } from './MembersSection'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('../api/client', () => ({ api }))
vi.mock('../auth/session', () => ({ useSessionUser: () => ({ data: { id: 'u-me' } }) }))

const DEPARTMENTS = [
  { id: 'd-lx', code: 'LX' },
  { id: 'd-snd', code: 'SND' },
] as DepartmentRow[]

const MEMBERS = [
  {
    membershipId: 'm1',
    userId: 'u-me',
    name: 'Jayden',
    email: 'j@x.test',
    role: 'owner',
    departments: ['*'],
  },
  {
    membershipId: 'm2',
    userId: 'u-oli',
    name: 'Oli',
    email: 'oli@x.test',
    role: 'editor',
    departments: ['d-snd'],
  },
]

function renderSection(editable: boolean) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MembersSection showId="s1" departments={DEPARTMENTS} editable={editable} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  installDialogPolyfill()
  vi.clearAllMocks()
  api.get.mockResolvedValue({ members: MEMBERS })
  api.post.mockResolvedValue({})
  api.patch.mockResolvedValue({})
  api.del.mockResolvedValue({})
})

const row = (name: string) =>
  screen.getByRole('list', { name: 'Members' }).querySelectorAll('li')[name === 'Jayden' ? 0 : 1]

test("the owner's own row says You and has no role select or Remove", async () => {
  renderSection(true)
  await screen.findByText('Oli')
  const me = within(row('Jayden') as HTMLElement)
  expect(me.getByText('You')).toBeTruthy()
  expect(me.queryByRole('combobox')).toBeNull()
  expect(me.queryByRole('button', { name: /Remove/ })).toBeNull()
})

test('another member has a role select, department scope boxes and Remove', async () => {
  renderSection(true)
  await screen.findByText('Oli')
  const oli = within(row('Oli') as HTMLElement)
  fireEvent.change(oli.getByRole('combobox', { name: 'Oli role' }), { target: { value: 'viewer' } })
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/memberships/m2', { role: 'viewer' }))
  expect(oli.getByLabelText('All departments')).toBeTruthy()
  expect((oli.getByLabelText('SND') as HTMLButtonElement).disabled).toBe(true)
})

test('Remove asks first', async () => {
  renderSection(true)
  await screen.findByText('Oli')
  fireEvent.click(screen.getByRole('button', { name: 'Remove Oli' }))
  expect(api.del).not.toHaveBeenCalled()
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Remove',
    ) as HTMLElement,
  )
  await waitFor(() => expect(api.del).toHaveBeenCalledWith('/memberships/m2'))
})

test('inviting posts the email and role', async () => {
  renderSection(true)
  await screen.findByText('Oli')
  const form = screen.getByRole('form', { name: 'Invite member' })
  fireEvent.change(within(form).getByLabelText('Invite by email'), {
    target: { value: 'new@x.test' },
  })
  fireEvent.change(within(form).getByLabelText('Invite role'), { target: { value: 'viewer' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Invite' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/shows/s1/members', {
      email: 'new@x.test',
      role: 'viewer',
    }),
  )
})

test('a non-owner reads names and roles and sees no controls', async () => {
  renderSection(false)
  await screen.findByText('Oli')
  expect(screen.queryByRole('form', { name: 'Invite member' })).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.getByRole('list', { name: 'Members' }).textContent).toContain('Editor (SND)')
})
