import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  setActive: vi.fn(),
  setHidden: vi.fn(),
  setLocked: vi.fn(),
  hidden: [] as string[],
  locked: [] as string[],
}))

vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => ({
    data: sql.includes('FROM cues')
      ? [
          { id: 'lx', n: 61 },
          { id: 'snd', n: 28 },
        ]
      : [{ kind: 'department', id: 'lx', n: 2 }],
  }),
}))
vi.mock('./useLayers', () => ({
  useLayers: () => ({
    userId: 'u1',
    departments: [
      { id: 'lx', code: 'LX', name: 'Lighting', colour: '#C9811F', hidden: 0 },
      { id: 'snd', code: 'SND', name: 'Sound', colour: '#4A90E2', hidden: 0 },
      { id: 'sm', code: 'SM', name: 'Stage management', colour: '#2A9D8F', hidden: 1 },
    ],
    editable: [
      { kind: 'department', id: 'lx' },
      { kind: 'personal', id: 'u1' },
    ],
    active: { kind: 'department', id: 'lx' },
    state: { hidden: h.hidden, locked: h.locked, active: null },
    store: { setActive: h.setActive, setHidden: h.setHidden, setLocked: h.setLocked },
  }),
}))

import { LayerPanel } from './LayerPanel'

beforeEach(() => {
  vi.clearAllMocks()
  h.hidden = []
  h.locked = []
})

const row = (key: string) => document.querySelector(`[data-layer="${key}"]`) as HTMLElement

test('it lists the non-hidden departments and the personal layer as rows with their counts', () => {
  render(<LayerPanel showId="s" versionId="v" />)
  const layers = screen.getByRole('region', { name: 'Layers' })
  // LX, SND and Personal: SM is a hidden department and has no row
  expect(within(layers).getAllByRole('listitem')).toHaveLength(3)
  // cues and annotations on a layer add up
  expect(row('department:lx').textContent).toContain('63')
  expect(row('department:snd').textContent).toContain('28')
  expect(row('personal:u1').textContent).toContain('only you')
})

test('a row is the mockup layer row: 30 px, the active one raised on the card, a hidden one faded', () => {
  h.hidden = ['department:snd']
  render(<LayerPanel showId="s" versionId="v" />)
  const lx = row('department:lx')
  expect(lx.className).toContain('h-[30px]')
  expect(lx.className).toContain('md:max-[1024px]:h-[38px]')
  expect(lx.className).toContain('max-md:h-11')
  expect(lx.className).toContain('bg-card')
  expect(lx.className).toContain('shadow-card')
  expect(row('department:snd').className).toContain('opacity-55')
  expect(row('department:snd').className).not.toContain('shadow-card')
})

test('the names the e2e use are kept: Active layer, Show and Lock, with the Active layer radio off for a layer you cannot edit', () => {
  render(<LayerPanel showId="s" versionId="v" />)
  expect((screen.getByLabelText('Active layer LX') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('Active layer SND') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Lock SND') as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('Active layer Personal'))
  expect(h.setActive).toHaveBeenCalledWith({ kind: 'personal', id: 'u1' })
  fireEvent.click(screen.getByLabelText('Show LX'))
  expect(h.setHidden).toHaveBeenCalledWith('department:lx', true)
  fireEvent.click(screen.getByLabelText('Lock LX'))
  expect(h.setLocked).toHaveBeenCalledWith('department:lx', true)
})

test('a locked layer shows its lock in amber', () => {
  h.locked = ['department:lx']
  render(<LayerPanel showId="s" versionId="v" />)
  const lock = screen.getByLabelText('Lock LX').parentElement as HTMLElement
  expect(lock.className).toContain('text-amber')
})
