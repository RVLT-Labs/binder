import { act, fireEvent, render, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CueEditor } from './CueEditor'
import { updateCue } from './mutations'
import { loadWordLayer } from './wordLayers'

const row: Record<string, unknown> = {
  id: 'c1',
  department_id: 'lx',
  major: 10,
  minor: 0,
  label: 'Sunrise',
  type: 'go',
  notes: '',
  colour: null,
  anchor: null,
}
vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({}),
  useQuery: () => ({ data: [row] }),
}))
const h = vi.hoisted(() => ({
  peers: [] as Array<{ userId: string; name: string }>,
  reason: null as string | null,
  setBubble: vi.fn(async () => {}),
}))
vi.mock('./wordLayers', () => ({ loadWordLayer: vi.fn(async () => null) }))
vi.mock('../presence/PresenceProvider', () => ({
  usePresencePeers: () => ({ peers: h.peers, connected: true }),
}))
vi.mock('./MarkupSession', () => ({
  useMarkupSession: () => ({
    userId: 'me',
    versionId: 'v',
    departments: [{ id: 'lx', code: 'LX', name: 'Lighting', number_format: 'decimal' }],
    editable: [{ kind: 'department', id: 'lx' }],
    pages: [{ words_key: 'w0' }, { words_key: 'w1' }],
    whyCantEdit: () => h.reason,
    editContext: () => ({ showId: 's', userId: 'u', scope: { role: 'owner', departments: [] } }),
    removeCue: vi.fn(),
    setBubble: h.setBubble,
  }),
}))
vi.mock('./mutations', async (original) => ({
  ...(await original<typeof import('./mutations')>()),
  updateCue: vi.fn(async () => {}),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadWordLayer).mockResolvedValue(null)
})

test('Escape in a text field cancels the edit and leaves the selection alone', () => {
  const { getByLabelText } = render(<CueEditor cueId="c1" />)
  const label = getByLabelText('Label') as HTMLInputElement
  label.focus()
  fireEvent.change(label, { target: { value: 'Sunset' } })
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    label.dispatchEvent(escapeKey)
  })
  // Handled here: the viewer's Escape-deselects shortcut sees it as already dealt with.
  expect(escapeKey.defaultPrevented).toBe(true)
  expect(label.value).toBe('Sunrise')
  expect(document.activeElement).not.toBe(label)
  expect(updateCue).not.toHaveBeenCalled()
})

test('Escape in a choice blurs it without deselecting', () => {
  const { getByLabelText } = render(<CueEditor cueId="c1" />)
  const layer = getByLabelText('Layer') as HTMLSelectElement
  layer.focus()
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    layer.dispatchEvent(escapeKey)
  })
  expect(escapeKey.defaultPrevented).toBe(true)
  expect(document.activeElement).not.toBe(layer)
})

test('Type is a segmented control with Go, Standby and Warn, and choosing one saves at once', () => {
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const type = getByRole('radiogroup', { name: 'Type' })
  expect(
    within(type)
      .getAllByRole('radio')
      .map((r) => r.textContent),
  ).toEqual(['Go', 'Standby', 'Warn'])
  expect(within(type).getByRole('radio', { name: 'Go' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(within(type).getByRole('radio', { name: 'Warn' }))
  expect(updateCue).toHaveBeenCalledWith({}, expect.anything(), 'c1', { type: 'warn' })
})

test('the head is the department swatch, its code, the number in mono and the anchor state', () => {
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const heading = getByRole('heading')
  expect(heading.textContent).toBe('LX 10')
  expect(heading.querySelector('.font-mono')?.textContent).toBe('10')
  expect(getByRole('region', { name: 'Cue editor' }).textContent).toContain('ok')
})

test('Trigger shows the words the cue sits on and their page', () => {
  row.anchor = {
    documentId: 'd',
    documentVersionId: 'v',
    pageIndex: 2,
    x: 1,
    y: 2,
    status: 'ok',
    text: { quote: 'A new world calls', wordStart: 0, wordEnd: 3 },
  } as never
  const { getByText } = render(<CueEditor cueId="c1" />)
  const quote = getByText(/A new world calls/)
  expect(quote.textContent).toContain('p.3')
  expect(quote.className).toContain('font-mono')
  row.anchor = null
})

test('Delete is plain and named Delete cue; Done (phone) is drawn only when the panel supplies it', () => {
  const onDone = vi.fn()
  const { getByRole, queryByRole, rerender } = render(<CueEditor cueId="c1" />)
  expect(getByRole('button', { name: 'Delete cue' }).textContent).toBe('Delete')
  expect(queryByRole('button', { name: 'Done' })).toBeNull()
  rerender(<CueEditor cueId="c1" onDone={onDone} />)
  fireEvent.click(getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledTimes(1)
})

test('a field still commits on Enter', () => {
  const { getByLabelText } = render(<CueEditor cueId="c1" />)
  const label = getByLabelText('Label') as HTMLInputElement
  label.focus()
  fireEvent.change(label, { target: { value: 'Sunset' } })
  fireEvent.keyDown(label, { key: 'Enter' })
  expect(updateCue).toHaveBeenCalledWith({}, expect.anything(), 'c1', { label: 'Sunset' })
})

test('Escape in the Number field clears a stale error as it restores the stored value', () => {
  const { getByLabelText, queryByRole } = render(<CueEditor cueId="c1" />)
  const number = getByLabelText('Number') as HTMLInputElement
  number.focus()
  fireEvent.change(number, { target: { value: 'ten' } })
  fireEvent.blur(number)
  expect(queryByRole('alert')?.textContent).toMatch(/Cue numbers look like/)
  // Back in the field with the bad draft still there, Escape abandons it.
  number.focus()
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    number.dispatchEvent(escapeKey)
  })
  expect(number.value).toBe('10')
  expect(queryByRole('alert')).toBeNull()
  expect(updateCue).not.toHaveBeenCalled()
})

test('"edited by" names the person from presence, says you for yourself, and a teammate otherwise', () => {
  row.updated_at = new Date().toISOString()
  row.updated_by = 'u2'
  const { container, rerender } = render(<CueEditor cueId="c1" />)
  expect(container.textContent).toContain('edited by a teammate · just now')
  h.peers = [{ userId: 'u2', name: 'Oli' }]
  rerender(<CueEditor cueId="c2" />)
  expect(container.textContent).toContain('edited by Oli · just now')
  row.updated_by = 'me'
  rerender(<CueEditor cueId="c3" />)
  expect(container.textContent).toContain('edited by you')
  delete row.updated_at
  delete row.updated_by
  h.peers = []
})

const placedAnchor = (extra: Record<string, unknown> = {}) => ({
  documentId: 'd',
  documentVersionId: 'v',
  pageIndex: 1,
  x: 10,
  y: 20,
  status: 'ok',
  text: { quote: 'hello', wordStart: 0, wordEnd: 0 },
  ...extra,
})

test("the Mark control shows the cue's mark and has four options named Underline, Highlight, Line and Line with pointer", () => {
  row.anchor = placedAnchor({ mark: 'highlight' }) as never
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const mark = getByRole('radiogroup', { name: 'Mark' })
  expect(
    within(mark)
      .getAllByRole('radio')
      .map((r) => r.textContent),
  ).toEqual(['Underline', 'Highlight', 'Line', 'Line with pointer'])
  expect(within(mark).getByRole('radio', { name: 'Highlight' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  // directly under Type
  const groups = [
    ...getByRole('region', { name: 'Cue editor' }).querySelectorAll('[role=radiogroup]'),
  ]
  expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Type', 'Mark'])
  row.anchor = null
})

test('the Mark options have no fixed height, so "Line with pointer" wraps instead of clipping', () => {
  row.anchor = placedAnchor() as never
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const radios = within(getByRole('radiogroup', { name: 'Mark' })).getAllByRole('radio')
  expect(radios).toHaveLength(4)
  for (const r of radios) {
    const tokens = r.className.split(/\s+/)
    // any height utility (at any breakpoint) must be h-auto; the floor is a min-height
    expect(tokens.filter((t) => /(^|:)h-/.test(t) && !/(^|:)h-auto$/.test(t))).toEqual([])
    expect(tokens).toContain('h-auto')
    expect(tokens).toContain('md:h-auto')
    expect(tokens).toContain('md:max-[1024px]:h-auto')
    expect(tokens).toContain('whitespace-normal')
    expect(tokens).toContain('leading-tight')
    expect(tokens.some((t) => /(^|:)min-h-/.test(t))).toBe(true)
  }
  // the 44 px touch floor stays on the phone and on coarse pointers
  expect(radios[3]?.className).toContain('min-h-11')
  expect(radios[3]?.className).toContain('pointer-coarse:min-h-11')
})

test('a cue with no mark shows Underline', () => {
  row.anchor = placedAnchor() as never
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const mark = getByRole('radiogroup', { name: 'Mark' })
  expect(within(mark).getByRole('radio', { name: 'Underline' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  row.anchor = null
})

test('choosing Line saves an anchor with mark line and offset 0 (x at the caret once the layer loads)', async () => {
  row.anchor = placedAnchor() as never
  const layer = {
    words: [{ t: 'hello', x: 100, y: 50, w: 50, h: 10 }],
    lines: [[0]],
  }
  vi.mocked(loadWordLayer).mockResolvedValueOnce(layer as never)
  const { getByRole } = render(<CueEditor cueId="c1" />)
  fireEvent.click(
    within(getByRole('radiogroup', { name: 'Mark' })).getByRole('radio', { name: 'Line' }),
  )
  await vi.waitFor(() => expect(updateCue).toHaveBeenCalledTimes(1))
  expect(loadWordLayer).toHaveBeenCalledWith('w1')
  const [, , id, patch] = vi.mocked(updateCue).mock.calls[0]
  expect(id).toBe('c1')
  const anchor = (patch as { anchor: { mark: string; x: number; text: { offset: number } } }).anchor
  expect(anchor.mark).toBe('line')
  expect(anchor.text.offset).toBe(0)
  expect(anchor.x).toBe(100)
  row.anchor = null
})

test("a cue anchored on another version does not take its offset or x from this version's words", async () => {
  row.anchor = placedAnchor({ documentVersionId: 'older' }) as never
  const layer = {
    words: [{ t: 'hello', x: 100, y: 50, w: 50, h: 10 }],
    lines: [[0]],
  }
  vi.mocked(loadWordLayer).mockResolvedValue(layer as never)
  const { getByRole } = render(<CueEditor cueId="c1" />)
  fireEvent.click(
    within(getByRole('radiogroup', { name: 'Mark' })).getByRole('radio', { name: 'Line' }),
  )
  await vi.waitFor(() => expect(updateCue).toHaveBeenCalledTimes(1))
  // the layer belongs to the open version, not the cue's: it is not read, and x stays where it was
  expect(loadWordLayer).not.toHaveBeenCalled()
  const patch = vi.mocked(updateCue).mock.calls[0][3] as { anchor: { mark: string; x: number } }
  expect(patch.anchor.mark).toBe('line')
  expect(patch.anchor.x).toBe(10)
  row.anchor = null
})

test('choosing Line still saves when the page has no word layer', async () => {
  row.anchor = placedAnchor() as never
  const { getByRole } = render(<CueEditor cueId="c1" />)
  fireEvent.click(
    within(getByRole('radiogroup', { name: 'Mark' })).getByRole('radio', { name: 'Line' }),
  )
  await vi.waitFor(() => expect(updateCue).toHaveBeenCalledTimes(1))
  const patch = vi.mocked(updateCue).mock.calls[0][3] as { anchor: { mark: string; x: number } }
  expect(patch.anchor.mark).toBe('line')
  expect(patch.anchor.x).toBe(10)
  row.anchor = null
})

test('choosing Underline from Line removes the offset and the mark key', async () => {
  row.anchor = placedAnchor({
    mark: 'line',
    text: { quote: 'hello', wordStart: 0, wordEnd: 0, offset: 2 },
  }) as never
  const { getByRole } = render(<CueEditor cueId="c1" />)
  fireEvent.click(
    within(getByRole('radiogroup', { name: 'Mark' })).getByRole('radio', { name: 'Underline' }),
  )
  await vi.waitFor(() => expect(updateCue).toHaveBeenCalledTimes(1))
  const { anchor } = vi.mocked(updateCue).mock.calls[0][3]
  expect(anchor).toBeTruthy()
  expect('mark' in (anchor ?? {})).toBe(false)
  expect('offset' in (anchor?.text ?? {})).toBe(false)
  row.anchor = null
})

test('choosing the current mark does nothing', () => {
  row.anchor = placedAnchor() as never
  const { getByRole } = render(<CueEditor cueId="c1" />)
  fireEvent.click(
    within(getByRole('radiogroup', { name: 'Mark' })).getByRole('radio', { name: 'Underline' }),
  )
  expect(updateCue).not.toHaveBeenCalled()
  row.anchor = null
})

test('the control is disabled for an unplaced cue and for a cue the user cannot edit', () => {
  row.anchor = null
  const unplaced = render(<CueEditor cueId="c1" />)
  for (const r of within(unplaced.getByRole('radiogroup', { name: 'Mark' })).getAllByRole(
    'radio',
  )) {
    expect((r as HTMLButtonElement).disabled).toBe(true)
  }
  unplaced.unmount()

  row.anchor = placedAnchor() as never
  const open = render(<CueEditor cueId="c1" />)
  for (const r of within(open.getByRole('radiogroup', { name: 'Mark' })).getAllByRole('radio')) {
    expect((r as HTMLButtonElement).disabled).toBe(false)
  }
  open.unmount()

  h.reason = 'This layer is locked.'
  const locked = render(<CueEditor cueId="c1" />)
  for (const r of within(locked.getByRole('radiogroup', { name: 'Mark' })).getAllByRole('radio')) {
    expect((r as HTMLButtonElement).disabled).toBe(true)
  }
  h.reason = null
  row.anchor = null
})

test('the Bubble row says "In the margin" or "Moved"; Reset to margin appears only when moved and clears tag; it is disabled when the cue is read-only', () => {
  // in the margin: a word, and no reset button
  row.anchor = placedAnchor() as never
  const margin = render(<CueEditor cueId="c1" />)
  const group = margin.getByRole('group', { name: 'Bubble' })
  expect(group.textContent).toBe('In the margin')
  expect(margin.queryByRole('button', { name: 'Reset to margin' })).toBeNull()
  // directly under Mark
  const fields = [
    ...margin
      .getByRole('region', { name: 'Cue editor' })
      .querySelectorAll('[role=radiogroup], fieldset[aria-label]'),
  ]
  expect(fields.map((g) => g.getAttribute('aria-label'))).toEqual(['Type', 'Mark', 'Bubble'])
  margin.unmount()

  // moved: the word changes and Reset to margin clears the tag
  row.anchor = placedAnchor({ tag: { dx: 30, dy: -4 } }) as never
  const moved = render(<CueEditor cueId="c1" />)
  expect(moved.getByRole('group', { name: 'Bubble' }).textContent).toContain('Moved')
  expect(moved.getByRole('group', { name: 'Bubble' }).textContent).not.toContain('In the margin')
  const reset = moved.getByRole('button', { name: 'Reset to margin' }) as HTMLButtonElement
  expect(reset.disabled).toBe(false)
  fireEvent.click(reset)
  expect(h.setBubble).toHaveBeenCalledWith('c1', null)
  moved.unmount()

  // read-only: the button is there but disabled, and nothing is written
  h.reason = 'This layer is locked.'
  const locked = render(<CueEditor cueId="c1" />)
  expect(locked.getByRole('group', { name: 'Bubble' }).textContent).toContain('Moved')
  const lockedReset = locked.getByRole('button', { name: 'Reset to margin' }) as HTMLButtonElement
  expect(lockedReset.disabled).toBe(true)
  fireEvent.click(lockedReset)
  expect(h.setBubble).toHaveBeenCalledTimes(1)
  h.reason = null
  row.anchor = null
})

test('an unplaced cue has no bubble to move: the row says In the margin and offers no reset', () => {
  row.anchor = null
  const { getByRole, queryByRole } = render(<CueEditor cueId="c1" />)
  expect(getByRole('group', { name: 'Bubble' }).textContent).toBe('In the margin')
  expect(queryByRole('button', { name: 'Reset to margin' })).toBeNull()
})

test('Reset to margin is full width on a phone and a 44 px target on coarse pointers', () => {
  row.anchor = placedAnchor({ tag: { dx: 1, dy: 1 } }) as never
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const className = getByRole('button', { name: 'Reset to margin' }).className
  expect(className).toContain('max-md:w-full')
  expect(className).toContain('pointer-coarse:min-h-11')
  row.anchor = null
})
