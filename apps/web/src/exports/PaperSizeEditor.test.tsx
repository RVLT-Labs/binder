import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { PaperSizeEditor } from './PaperSizeEditor'
import { readPaperSize } from './paperSize'

let settings: string | null
const db = {
  execute: vi.fn(async (_sql: string, _params: unknown[]) => {}),
  getOptional: vi.fn(async () => ({ settings })),
}
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  useQuery: () => ({ data: [{ settings }] }),
}))

beforeEach(() => {
  settings = '{"stampSet":["Go"]}'
  vi.clearAllMocks()
})

test('a show with no paper size says A4', () => {
  const { getByLabelText } = render(<PaperSizeEditor showId="s1" editable />)
  expect((getByLabelText('Paper size') as HTMLSelectElement).value).toBe('A4')
})

test('the owner changes it; it is saved through the show update and other settings survive', async () => {
  const { getByLabelText } = render(<PaperSizeEditor showId="s1" editable />)
  await act(async () => {
    fireEvent.change(getByLabelText('Paper size'), { target: { value: 'Letter' } })
  })
  const call = db.execute.mock.calls.at(-1)
  expect(call?.[0]).toBe('UPDATE shows SET settings = ? WHERE id = ?')
  expect(call?.[1]?.[1]).toBe('s1')
  const written = call?.[1]?.[0] as string
  expect(readPaperSize(written)).toBe('Letter')
  expect(JSON.parse(written)).toMatchObject({ stampSet: ['Go'] })
})

test('a non-owner reads it and cannot change it', () => {
  settings = '{"paperSize":"Letter"}'
  const { queryByLabelText, getByText } = render(<PaperSizeEditor showId="s1" editable={false} />)
  expect(queryByLabelText('Paper size')).toBeNull()
  expect(getByText(/Letter/)).toBeTruthy()
  expect(db.execute).not.toHaveBeenCalled()
})
