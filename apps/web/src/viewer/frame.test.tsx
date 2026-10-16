import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { MarkupSession } from '../markup/MarkupSession'
import { ToolStrip } from '../markup/ToolStrip'
import { setTool } from '../markup/tools'
import { FIT_ALLOWANCE, PAGE_GUTTER } from './controls'
import { StatusBar } from './StatusBar'
import { THUMB_WIDTH } from './ThumbnailRail'

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

test('undo, redo and the snap toggle keep their names', () => {
  render(<ToolStrip />)
  expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', false)
  expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true)
  const snap = screen.getByLabelText('Snap to text') as HTMLInputElement
  expect(snap.checked).toBe(true)
  fireEvent.click(snap)
  expect((h.session.setSnap as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([false])
})

test('the cue type and stamp choices appear beside their tool while it is chosen', () => {
  render(<ToolStrip />)
  expect(screen.queryByLabelText('Cue type')).toBeNull()
  expect(screen.queryByLabelText('Stamp', { exact: true })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Cue tool' }))
  const type = screen.getByLabelText('Cue type') as HTMLSelectElement
  expect([...type.options].map((o) => o.text)).toEqual(['Go', 'Standby', 'Warning'])
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

test('thumbnails are 96 px wide and fit width leaves the tool strip clear of the page', () => {
  expect(THUMB_WIDTH).toBe(96)
  // Both sides of the page list keep the strip's lane, plus room for a classic scrollbar.
  expect(FIT_ALLOWANCE).toBeGreaterThanOrEqual(2 * PAGE_GUTTER)
})
