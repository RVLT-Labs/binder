import { act, fireEvent, render, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { MarkerSideEditor } from './MarkerSideEditor'

let settings: string | null
const departments = [
  { id: 'd-lx', show_id: 's1', code: 'LX', name: 'Lighting', hidden: 0, sort_order: 0 },
  { id: 'd-snd', show_id: 's1', code: 'SND', name: 'Sound', hidden: 0, sort_order: 10 },
  { id: 'd-old', show_id: 's1', code: 'OLD', name: 'Old', hidden: 1, sort_order: 20 },
]
const db = {
  execute: vi.fn(async (_sql: string, _params: unknown[]) => {}),
  getOptional: vi.fn(async () => ({ settings })),
}
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  useQuery: (sql: string) => ({
    data: sql.includes('FROM departments') ? departments : [{ settings }],
  }),
}))

beforeEach(() => {
  settings = '{"timezone":"Europe/London"}'
  vi.clearAllMocks()
})

const group = (r: ReturnType<typeof render>, code: string) => r.getByRole('group', { name: code })

test('an owner sees every visible department, left unless the show says right', () => {
  settings = '{"markerSides":{"d-snd":"right"}}'
  const r = render(<MarkerSideEditor showId="s1" editable />)
  expect(r.queryByRole('group', { name: 'OLD' })).toBeNull()
  const lx = within(group(r, 'LX'))
  expect((lx.getByRole('radio', { name: 'Left' }) as HTMLInputElement).checked).toBe(true)
  expect((lx.getByRole('radio', { name: 'Right' }) as HTMLInputElement).checked).toBe(false)
  const snd = within(group(r, 'SND'))
  expect((snd.getByRole('radio', { name: 'Right' }) as HTMLInputElement).checked).toBe(true)
})

test('the owner picks a side; it is saved through the show update and other settings survive', async () => {
  const r = render(<MarkerSideEditor showId="s1" editable />)
  await act(async () => {
    fireEvent.click(within(group(r, 'SND')).getByRole('radio', { name: 'Right' }))
  })
  const call = db.execute.mock.calls.at(-1)
  expect(call?.[0]).toBe('UPDATE shows SET settings = ? WHERE id = ?')
  expect(call?.[1]?.[1]).toBe('s1')
  expect(JSON.parse(call?.[1]?.[0] as string)).toEqual({
    timezone: 'Europe/London',
    markerSides: { 'd-snd': 'right' },
  })
})

test('the latest settings are read just before writing, so another key or side is not overwritten', async () => {
  const r = render(<MarkerSideEditor showId="s1" editable />)
  // Another device changed settings after this render.
  settings = '{"paperSize":"Letter","markerSides":{"d-lx":"right"}}'
  await act(async () => {
    fireEvent.click(within(group(r, 'SND')).getByRole('radio', { name: 'Right' }))
  })
  expect(JSON.parse(db.execute.mock.calls.at(-1)?.[1]?.[0] as string)).toEqual({
    paperSize: 'Letter',
    markerSides: { 'd-lx': 'right', 'd-snd': 'right' },
  })
})

test('a non-owner reads the sides and cannot change them', () => {
  settings = '{"markerSides":{"d-snd":"right"}}'
  const r = render(<MarkerSideEditor showId="s1" editable={false} />)
  expect(r.queryAllByRole('radio')).toHaveLength(0)
  const items = within(r.getByRole('list', { name: 'Tag sides' })).getAllByRole('listitem')
  expect(items.map((i) => i.textContent)).toEqual(['LX: left', 'SND: right'])
})
