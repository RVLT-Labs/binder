import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { DepartmentRow } from '../markup/useDepartments'
import { DepartmentsSection, firstUnusedColour } from './DepartmentsSection'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('../api/client', () => ({ api }))
const show = vi.hoisted(() => ({ settings: null as string | null, writes: [] as unknown[][] }))
vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({
    execute: vi.fn(),
    getOptional: vi.fn(async () => ({ settings: show.settings })),
    writeTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        getOptional: async () => ({ settings: show.settings }),
        execute: async (_sql: string, params: unknown[]) => {
          show.writes.push(params)
        },
      }),
  }),
  useQuery: (sql: string) => ({
    data: sql.includes('FROM cues')
      ? [{ department_id: 'd-lx', n: 61 }]
      : [{ settings: show.settings }],
  }),
}))

const dept = (over: Partial<DepartmentRow>): DepartmentRow =>
  ({
    id: 'd-lx',
    show_id: 's1',
    code: 'LX',
    name: 'Lighting',
    colour: '#C9811F',
    number_format: 'decimal',
    hidden: 0,
    sort_order: 0,
    ...over,
  }) as DepartmentRow

const DEPARTMENTS = [dept({}), dept({ id: 'd-snd', code: 'SND', name: 'Sound', colour: '#2F6BD6' })]

function renderSection(editable: boolean, departments = DEPARTMENTS) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <DepartmentsSection showId="s1" departments={departments} editable={editable} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  show.settings = null
  show.writes = []
  api.patch.mockResolvedValue({})
  api.post.mockResolvedValue({})
})

test('a new department starts on the first preset colour no department has', () => {
  expect(firstUnusedColour([{ colour: '#C9811F' }, { colour: '#2f6bd6' }])).toBe('#7A5CD0')
  expect(firstUnusedColour([])).toBe('#C9811F')
  // every preset taken: back to the first
  expect(
    firstUnusedColour(
      ['#C9811F', '#2F6BD6', '#7A5CD0', '#1C8B83', '#C2487E', '#CC5E2E', '#6E8C12'].map((c) => ({
        colour: c,
      })),
    ),
  ).toBe('#C9811F')
})

test('the add form posts that colour', async () => {
  renderSection(true)
  const form = screen.getByRole('form', { name: 'Add department' })
  fireEvent.change(within(form).getByLabelText('New department code'), {
    target: { value: 'PYRO' },
  })
  fireEvent.change(within(form).getByLabelText('New department name'), {
    target: { value: 'Pyrotechnics' },
  })
  fireEvent.click(within(form).getByRole('button', { name: 'Add department' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/shows/s1/departments', {
      code: 'PYRO',
      name: 'Pyrotechnics',
      colour: '#7A5CD0',
      numberFormat: 'decimal',
    }),
  )
})

test('number format and marker side are segmented controls under the existing names', async () => {
  renderSection(true)
  const format = screen.getByRole('radiogroup', { name: 'LX number format' })
  expect(within(format).getByRole('radio', { name: '10.5' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  expect(screen.getByRole('radiogroup', { name: 'LX marker side' })).toBeTruthy()
  fireEvent.click(within(format).getByRole('radio', { name: '10.50' }))
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('/departments/d-lx', { numberFormat: 'point' }),
  )
})

test('hiding is a labelled checkbox; the colour is a button that opens the presets', async () => {
  renderSection(true)
  fireEvent.click(screen.getAllByLabelText('Hidden')[0])
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/departments/d-lx', { hidden: true }))
  fireEvent.click(screen.getByRole('button', { name: 'LX colour' }))
  fireEvent.click(screen.getByRole('radio', { name: 'SM preset' }))
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('/departments/d-lx', { colour: '#1C8B83' }),
  )
})

test('the table shows the cue count per department', () => {
  renderSection(true)
  expect(screen.getByText('61')).toBeTruthy()
})

test('a non-owner reads the table and has no controls', () => {
  renderSection(false, [dept({ hidden: 1, number_format: 'point' })])
  expect(screen.queryByRole('form', { name: 'Add department' })).toBeNull()
  expect(screen.queryAllByRole('radio')).toHaveLength(0)
  expect(screen.queryByRole('checkbox')).toBeNull()
  const row = screen.getByRole('list', { name: 'Departments' }).textContent ?? ''
  expect(row).toContain('LX')
  expect(row).toContain('Lighting')
  expect(row).toContain('10.50')
  expect(row).toContain('Left')
  expect(row).toContain('hidden')
})

test('the owner has a connector width and pattern control on every department card', () => {
  show.settings = '{"connectorStyles":{"d-snd":{"width":"bold","pattern":"dashed"}}}'
  renderSection(true)
  expect(screen.getByRole('radiogroup', { name: 'LX connector width' })).toBeTruthy()
  expect(screen.getByRole('radiogroup', { name: 'LX connector pattern' })).toBeTruthy()
  const bold = within(screen.getByRole('radiogroup', { name: 'SND connector width' })).getByRole(
    'radio',
    { name: 'Bold' },
  )
  expect(bold.getAttribute('aria-checked')).toBe('true')
  const dashed = within(
    screen.getByRole('radiogroup', { name: 'SND connector pattern' }),
  ).getByRole('radio', { name: 'Dashed' })
  expect(dashed.getAttribute('aria-checked')).toBe('true')
})

test('a non-owner reads the connector style as words, with no controls', () => {
  show.settings = '{"connectorStyles":{"d-lx":{"width":"bold","pattern":"dashed"}}}'
  renderSection(false, [dept({}), dept({ id: 'd-snd', code: 'SND', name: 'Sound' })])
  expect(screen.queryAllByRole('radio')).toHaveLength(0)
  const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
  expect(rows[0]).toContain('Bold')
  expect(rows[0]).toContain('Dashed')
  expect(rows[1]).toContain('Thin')
  expect(rows[1]).toContain('Solid')
})

test('the owner has a Normal / Large cue size control on every department; choosing Large writes settings.cueSizes and keeps the rest', async () => {
  show.settings = '{"markerSides":{"d-snd":"right"},"cueSizes":{"d-snd":"large"}}'
  renderSection(true)
  const lx = screen.getByRole('radiogroup', { name: 'LX cue size' })
  expect(within(lx).getByRole('radio', { name: 'Normal' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  const snd = screen.getByRole('radiogroup', { name: 'SND cue size' })
  expect(within(snd).getByRole('radio', { name: 'Large' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  fireEvent.click(within(lx).getByRole('radio', { name: 'Large' }))
  await waitFor(() => expect(show.writes).toHaveLength(1))
  expect(JSON.parse(show.writes[0]?.[0] as string)).toEqual({
    markerSides: { 'd-snd': 'right' },
    cueSizes: { 'd-snd': 'large', 'd-lx': 'large' },
  })
  expect(show.writes[0]?.[1]).toBe('s1')
})

test('a non-owner reads the cue size as a word, with no control', () => {
  show.settings = '{"cueSizes":{"d-lx":"large"}}'
  renderSection(false, [dept({}), dept({ id: 'd-snd', code: 'SND', name: 'Sound' })])
  expect(screen.queryByRole('radiogroup', { name: 'LX cue size' })).toBeNull()
  const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
  expect(rows[0]).toContain('Cue size')
  expect(rows[0]).toContain('Large')
  expect(rows[1]).toContain('Normal')
})

test('a card reads in tab order: name, colour, number format, marker side, Hidden, then the connector and cue size controls', () => {
  renderSection(true)
  const inDom = [
    screen.getByLabelText('LX name'),
    screen.getByRole('button', { name: 'LX colour' }),
    screen.getByRole('radiogroup', { name: 'LX number format' }),
    screen.getByRole('radiogroup', { name: 'LX marker side' }),
    screen.getAllByLabelText('Hidden')[0],
    screen.getByRole('radiogroup', { name: 'LX connector width' }),
    screen.getByRole('radiogroup', { name: 'LX connector pattern' }),
    screen.getByRole('radiogroup', { name: 'LX cue size' }),
  ]
  // Each element comes after the one before it in the document (and so in the tab order).
  for (let i = 1; i < inDom.length; i++) {
    expect(
      inDom[i - 1].compareDocumentPosition(inDom[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      `${i}`,
    ).toBeTruthy()
  }
})
