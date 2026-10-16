import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { MarkupSession } from '../markup/MarkupSession'
import { ToolStrip } from '../markup/ToolStrip'
import { setTool } from '../markup/tools'
import { UndoRedoButtons } from '../markup/UndoRedoButtons'
import { fitAllowance, PAGE_GUTTER, TABLET_PAGE_GUTTER } from './controls'
import { StatusBar } from './StatusBar'
import { THUMB_COLUMN, THUMB_WIDTH } from './ThumbnailRail'

const h = vi.hoisted(() => ({ session: {} as Record<string, unknown> }))
vi.mock('../markup/MarkupSession', () => ({ useMarkupSession: () => h.session }))
vi.mock('../undo/useUndo', () => ({
  useUndo: () => ({ canUndo: true, canRedo: false, undo: async () => {}, redo: async () => {} }),
}))

function session(over: Partial<MarkupSession> = {}) {
  h.session = {
    showId: 's1',
    versionReadOnly: null,
    cueTarget: { departmentId: 'lx' },
    annotationTarget: { layer: { kind: 'department', id: 'lx' } },
    stamps: ['Hold', 'Go'],
    snap: true,
    setSnap: vi.fn(),
    viewer: { current: { focusSearch: vi.fn() } },
    ...over,
  }
}

beforeEach(() => {
  setTool('select', 'go')
  session()
})

const TOOLS: Array<[name: string, key: string]> = [
  ['Select', 'v'],
  ['Cue tool', 'c'],
  ['Highlight tool', 'h'],
  ['Note tool', 'n'],
  ['Rect tool', 'r'],
  ['Arrow tool', 'a'],
  ['Stamp tool', 's'],
  ['Find in document', '/'],
]

test.each(TOOLS)('the %s button keeps its name and shows its key %s', (name, key) => {
  render(<ToolStrip />)
  const button = screen.getByRole('button', { name })
  expect(button.textContent).toContain(key)
})

test('the annotation tools without a key (ellipse, line) are still there, with no hint', () => {
  render(<ToolStrip />)
  for (const name of ['Ellipse tool', 'Line tool']) {
    expect(screen.getByRole('button', { name }).textContent).toBe('')
  }
})

test('tools are aria-pressed buttons: choosing one presses it and releases the last', () => {
  render(<ToolStrip />)
  const select = screen.getByRole('button', { name: 'Select' })
  const rect = screen.getByRole('button', { name: 'Rect tool' })
  expect(select.getAttribute('aria-pressed')).toBe('true')
  expect(rect.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(rect)
  expect(rect.getAttribute('aria-pressed')).toBe('true')
  expect(select.getAttribute('aria-pressed')).toBe('false')
  // The same tool again goes back to select, as before.
  fireEvent.click(rect)
  expect(select.getAttribute('aria-pressed')).toBe('true')
})

test('the desktop strip has no undo or redo (they are in the top bar); the inline strip keeps them', () => {
  const { unmount } = render(<ToolStrip />)
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull()
  unmount()
  render(<ToolStrip variant="inline" />)
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Redo' })).toBeTruthy()
})

test('the top bar undo and redo keep their names and follow the undo stack', () => {
  render(<UndoRedoButtons />)
  expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', false)
  expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true)
})

test('the strip no longer has the snap toggle: it is the status bar word', () => {
  render(<ToolStrip />)
  expect(screen.queryByLabelText('Snap to text')).toBeNull()
  render(<ToolStrip variant="inline" />)
  expect(screen.queryByLabelText('Snap to text')).toBeNull()
})

test('the status bar word is the snap toggle: named "Snap to text", a checkbox, keyboard operable', () => {
  const onSnapChange = vi.fn()
  render(<StatusBar page={1} pages={3} snap onSnapChange={onSnapChange} activeLayer={null} />)
  const snap = screen.getByLabelText('Snap to text') as HTMLInputElement
  expect(snap.type).toBe('checkbox')
  expect(snap.checked).toBe(true)
  expect(screen.getByRole('region', { name: 'Script status' }).textContent).toContain(
    'Snap to text on',
  )
  fireEvent.click(snap)
  expect(onSnapChange).toHaveBeenCalledWith(false)
})

test('the cue type and stamp choices appear beside their tool while it is chosen', () => {
  render(<ToolStrip />)
  expect(screen.queryByLabelText('Cue type')).toBeNull()
  expect(screen.queryByLabelText('Stamp', { exact: true })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Cue tool' }))
  const type = screen.getByLabelText('Cue type') as HTMLSelectElement
  expect([...type.options].map((o) => o.text)).toEqual(['Go', 'Standby', 'Warn'])
  fireEvent.click(screen.getByRole('button', { name: 'Stamp tool' }))
  const stamp = screen.getByLabelText('Stamp', { exact: true }) as HTMLSelectElement
  expect([...stamp.options].map((o) => o.text)).toEqual(['Hold', 'Go'])
})

test('a disabled tool names its reason through aria-describedby on a .tool-hint', () => {
  session({ cueTarget: { disabled: 'This show is archived.' } })
  render(<ToolStrip />)
  const cue = screen.getByRole('button', { name: 'Cue tool' })
  expect(cue).toHaveProperty('disabled', true)
  const hint = document.getElementById(cue.getAttribute('aria-describedby') ?? '')
  expect(hint?.className).toContain('tool-hint')
  expect(hint?.textContent).toBe('This show is archived.')
})

test('the status bar reads the page, snap state and the active layer', () => {
  render(<StatusBar page={1} pages={43} snap activeLayer={{ name: 'LX', colour: '#C9811F' }} />)
  const bar = screen.getByRole('region', { name: 'Script status' })
  expect(bar.textContent).toContain('Page 1 of 43')
  expect(bar.textContent).toContain('Snap to text on')
  expect(within(bar).getByText('LX')).toBeTruthy()
})

test('the status bar says off when snapping is off', () => {
  render(<StatusBar page={2} pages={3} snap={false} activeLayer={null} />)
  expect(screen.getByRole('region', { name: 'Script status' }).textContent).toContain(
    'Snap to text off',
  )
})

test('thumbnails are the mockup 62 px in a 92 px column and fit width leaves the tool strip clear of the page', () => {
  expect(THUMB_WIDTH).toBe(62)
  expect(THUMB_COLUMN).toBe(92)
  // Both sides of the page list keep the strip's lane (12 px in, 60 wide at the tablet's 44 px
  // buttons), plus room for a classic scrollbar.
  // and the page keeps the mockup's ~19 px clear of it: 12 + 50 + 19 desktop, 12 + 60 + 19 tablet
  expect(PAGE_GUTTER).toBe(12 + 50 + 19)
  expect(TABLET_PAGE_GUTTER).toBe(12 + 60 + 19)
  expect(fitAllowance(PAGE_GUTTER)).toBeGreaterThanOrEqual(2 * PAGE_GUTTER)
})

test('the strip is the mockup tool set in its order, with ellipse and line after the box, one rule before Find', () => {
  render(<ToolStrip />)
  const names = within(screen.getByRole('group', { name: 'Markup tools' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'))
  expect(names).toEqual([
    'Select',
    'Cue tool',
    'Highlight tool',
    'Note tool',
    'Rect tool',
    'Ellipse tool',
    'Line tool',
    'Arrow tool',
    'Stamp tool',
    'Find in document',
  ])
  // Find is the strip's last tool now (undo and redo are in the top bar, snap in the status bar)
})

test('the strip and its buttons carry the mockup sizes: 34 px buttons on a card with radius 12', () => {
  render(<ToolStrip />)
  const strip = screen.getByRole('group', { name: 'Markup tools' })
  expect(strip.className).toContain('bg-card')
  expect(strip.className).toContain('rounded-[12px]')
  expect(strip.className).toContain('left-3')
  expect(strip.className).toContain('top-[18px]')
  expect(screen.getByRole('button', { name: 'Select' }).className).toContain(
    'min-[1025px]:size-[34px]',
  )
})

test('the status bar is 26 px with 11.5 px type, the layer name in its own colour, "on" in mono', () => {
  render(<StatusBar page={1} pages={43} snap activeLayer={{ name: 'LX', colour: '#C9811F' }} />)
  const bar = screen.getByRole('region', { name: 'Script status' })
  expect(bar.className).toContain('h-[26px]')
  expect(bar.className).toContain('text-[11.5px]')
  expect(within(bar).getByText('on').className).toContain('font-mono')
  expect(within(bar).getByText('LX').style.color).not.toBe('')
})
