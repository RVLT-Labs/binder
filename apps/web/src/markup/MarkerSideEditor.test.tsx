import { act, fireEvent, render, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  ConnectorStyleControls,
  MarkerSideControl,
  useConnectorStyles,
  useMarkerSides,
} from './MarkerSideEditor'

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
  settings = '{"timezone":"Europe/London"}'
  vi.clearAllMocks()
})

/** The departments table's marker side cells, wired to the show's settings. */
function Cells({ ids }: { ids: Array<{ id: string; code: string }> }) {
  const sides = useMarkerSides('s1')
  return (
    <>
      {ids.map((d) => (
        <MarkerSideControl
          key={d.id}
          code={d.code}
          side={sides.sideOf(d.id)}
          onChange={(side) => void sides.setSide(d.id, side)}
        />
      ))}
    </>
  )
}
const DEPARTMENTS = [
  { id: 'd-lx', code: 'LX' },
  { id: 'd-snd', code: 'SND' },
]

const group = (r: ReturnType<typeof render>, code: string) =>
  r.getByRole('radiogroup', { name: `${code} marker side` })
const checked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true'

test('each department is a Left / Right segmented control, left unless the show says right', () => {
  settings = '{"markerSides":{"d-snd":"right"}}'
  const r = render(<Cells ids={DEPARTMENTS} />)
  const lx = within(group(r, 'LX'))
  expect(checked(lx.getByRole('radio', { name: 'Left' }))).toBe(true)
  expect(checked(lx.getByRole('radio', { name: 'Right' }))).toBe(false)
  const snd = within(group(r, 'SND'))
  expect(checked(snd.getByRole('radio', { name: 'Right' }))).toBe(true)
})

test('the owner picks a side; it is saved through the show update and other settings survive', async () => {
  const r = render(<Cells ids={DEPARTMENTS} />)
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
  const r = render(<Cells ids={DEPARTMENTS} />)
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

/** The departments table's connector cells, wired to the show's settings. */
function ConnectorCells({ ids }: { ids: Array<{ id: string; code: string }> }) {
  const styles = useConnectorStyles('s1')
  return (
    <>
      {ids.map((d) => (
        <ConnectorStyleControls
          key={d.id}
          code={d.code}
          style={styles.styleOf(d.id)}
          onChange={(style) => void styles.setStyle(d.id, style)}
        />
      ))}
    </>
  )
}

test('each department has a Connector width and a Connector pattern control, thin and solid unless the show says otherwise', () => {
  settings = '{"connectorStyles":{"d-snd":{"width":"bold","pattern":"dotted"}}}'
  const r = render(<ConnectorCells ids={DEPARTMENTS} />)
  const lxWidth = within(r.getByRole('radiogroup', { name: 'LX connector width' }))
  expect(lxWidth.getAllByRole('radio').map((e) => e.textContent)).toEqual([
    'Thin',
    'Medium',
    'Bold',
  ])
  expect(checked(lxWidth.getByRole('radio', { name: 'Thin' }))).toBe(true)
  const lxPattern = within(r.getByRole('radiogroup', { name: 'LX connector pattern' }))
  expect(lxPattern.getAllByRole('radio').map((e) => e.textContent)).toEqual([
    'Solid',
    'Dashed',
    'Dotted',
  ])
  expect(checked(lxPattern.getByRole('radio', { name: 'Solid' }))).toBe(true)
  const snd = r.getByRole('radiogroup', { name: 'SND connector width' })
  expect(checked(within(snd).getByRole('radio', { name: 'Bold' }))).toBe(true)
  const sndPattern = r.getByRole('radiogroup', { name: 'SND connector pattern' })
  expect(checked(within(sndPattern).getByRole('radio', { name: 'Dotted' }))).toBe(true)
})

test('the owner picks a width; it is saved in settings.connectorStyles and the other keys survive', async () => {
  settings =
    '{"timezone":"Europe/London","markerSides":{"d-lx":"right"},"connectorStyles":{"d-lx":{"width":"medium","pattern":"dashed"}}}'
  const r = render(<ConnectorCells ids={DEPARTMENTS} />)
  await act(async () => {
    fireEvent.click(
      within(r.getByRole('radiogroup', { name: 'SND connector width' })).getByRole('radio', {
        name: 'Bold',
      }),
    )
  })
  const call = db.execute.mock.calls.at(-1)
  expect(call?.[0]).toBe('UPDATE shows SET settings = ? WHERE id = ?')
  expect(call?.[1]?.[1]).toBe('s1')
  expect(JSON.parse(call?.[1]?.[0] as string)).toEqual({
    timezone: 'Europe/London',
    markerSides: { 'd-lx': 'right' },
    connectorStyles: {
      'd-lx': { width: 'medium', pattern: 'dashed' },
      'd-snd': { width: 'bold', pattern: 'solid' },
    },
  })
})

test('picking a pattern keeps that department width, and the latest settings are read just before writing', async () => {
  settings = '{"connectorStyles":{"d-snd":{"width":"bold","pattern":"solid"}}}'
  const r = render(<ConnectorCells ids={DEPARTMENTS} />)
  // Another device changed settings after this render.
  settings =
    '{"paperSize":"Letter","connectorStyles":{"d-snd":{"width":"medium","pattern":"solid"}}}'
  await act(async () => {
    fireEvent.click(
      within(r.getByRole('radiogroup', { name: 'SND connector pattern' })).getByRole('radio', {
        name: 'Dashed',
      }),
    )
  })
  expect(JSON.parse(db.execute.mock.calls.at(-1)?.[1]?.[0] as string)).toEqual({
    paperSize: 'Letter',
    connectorStyles: { 'd-snd': { width: 'medium', pattern: 'dashed' } },
  })
})
