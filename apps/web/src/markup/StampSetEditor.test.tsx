import { DEFAULT_STAMPS } from '@binder/shared'
import { act, fireEvent, render, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { StampPicker } from './StampPicker'
import { StampSetEditor } from './StampSetEditor'
import { readStamps } from './stampSettings'

let settings: string | null
const db = {
  execute: vi.fn(async (_sql: string, _params: unknown[]) => {}),
  getOptional: vi.fn(async () => ({ settings })),
  // The settings writers read and write inside one write transaction.
  writeTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ getOptional: db.getOptional, execute: db.execute }),
}
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  useQuery: () => ({ data: [{ settings }] }),
}))

beforeEach(() => {
  settings = '{"timezone":"Europe/London"}'
  vi.clearAllMocks()
})

/** The stamp set the last write saved. */
function saved(): string[] {
  const call = db.execute.mock.calls.at(-1)
  expect(call?.[0]).toBe('UPDATE shows SET settings = ? WHERE id = ?')
  expect(call?.[1]?.[1]).toBe('s1')
  return readStamps(call?.[1]?.[0] as string)
}

test('a show with no stamp set lists the defaults', () => {
  const { getByRole } = render(<StampSetEditor showId="s1" editable />)
  const items = within(getByRole('list', { name: 'Stamps' })).getAllByRole('listitem')
  expect(items).toHaveLength(DEFAULT_STAMPS.length)
})

test('an owner edit is saved through the show update and appears in the stamp picker', async () => {
  const { getByLabelText, getByRole } = render(<StampSetEditor showId="s1" editable />)
  fireEvent.change(getByLabelText('New stamp name'), { target: { value: 'Hold' } })
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'Add stamp' }))
  })
  const written = db.execute.mock.calls.at(-1)?.[1]?.[0] as string
  // Other settings survive, the new stamp joins the set.
  expect(JSON.parse(written)).toMatchObject({ timezone: 'Europe/London' })
  expect(saved()).toEqual([...DEFAULT_STAMPS, 'Hold'])

  // The next sync brings that row to every member's session, whose picker reads it.
  const picker = render(
    <StampPicker stamps={readStamps(written)} value={null} onChange={() => {}} />,
  )
  const options = [...(picker.getByLabelText('Stamp') as HTMLSelectElement).options].map(
    (o) => o.value,
  )
  expect(options).toContain('Hold')
})

test('a stamp can be renamed and removed', async () => {
  settings = '{"stampSet":["Enter","Exit"]}'
  const { getByLabelText, getByRole } = render(<StampSetEditor showId="s1" editable />)
  const first = getByLabelText('Stamp 1 name') as HTMLInputElement
  first.focus()
  fireEvent.change(first, { target: { value: 'Walk on' } })
  await act(async () => {
    fireEvent.blur(first)
  })
  expect(saved()).toEqual(['Walk on', 'Exit'])
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'Remove Exit' }))
  })
  expect(saved()).toEqual(['Enter'])
})

test('the last stamp cannot be removed', () => {
  settings = '{"stampSet":["Only"]}'
  const { getByRole } = render(<StampSetEditor showId="s1" editable />)
  expect((getByRole('button', { name: 'Remove Only' }) as HTMLButtonElement).disabled).toBe(true)
})

test('a blank or repeated stamp is refused with a reason and nothing is written', async () => {
  settings = '{"stampSet":["Go"]}'
  const { getByLabelText, getByRole } = render(<StampSetEditor showId="s1" editable />)
  fireEvent.change(getByLabelText('New stamp name'), { target: { value: 'Go' } })
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'Add stamp' }))
  })
  expect(getByRole('alert').textContent).toBe('That stamp is already in the set.')
  fireEvent.change(getByLabelText('New stamp name'), { target: { value: '  ' } })
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'Add stamp' }))
  })
  expect(getByRole('alert').textContent).toBe('Give the stamp a name.')
  expect(db.execute).not.toHaveBeenCalled()
})

test('everyone else reads the set and cannot change it', () => {
  settings = '{"stampSet":["Enter","Exit"]}'
  const { queryByLabelText, queryByRole, getByRole } = render(
    <StampSetEditor showId="s1" editable={false} />,
  )
  expect(within(getByRole('list', { name: 'Stamps' })).getAllByRole('listitem')).toHaveLength(2)
  expect(queryByLabelText('Stamp 1 name')).toBeNull()
  expect(queryByRole('button', { name: 'Add stamp' })).toBeNull()
  expect(queryByRole('button', { name: /Remove/ })).toBeNull()
})
