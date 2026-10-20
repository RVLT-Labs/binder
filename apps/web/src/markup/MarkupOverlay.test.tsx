import type { WordLayer } from '@binder/shared'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PageRow } from '../powersync/schema'
import { MarkupOverlay } from './MarkupOverlay'
import { endRelocate, startRelocate } from './relocate'
import { setCueMark, setTool } from './tools'

const h = vi.hoisted(() => ({ session: {} as Record<string, unknown> }))
vi.mock('./MarkupSession', () => ({ useMarkupSession: () => h.session }))
vi.mock('../presence/PresenceProvider', () => ({
  usePresencePeers: () => ({ peers: [], connected: false }),
}))

const page = { id: 'p0', index: 0, width: 600, height: 800 } as unknown as PageRow
/** "To be or not" on one line (page y 700 to 710, centre 705), "Pirates of Penzance" below it. */
const words: WordLayer = {
  words: [
    { t: 'To', x: 50, y: 700, w: 14, h: 10 },
    { t: 'be', x: 68, y: 700, w: 14, h: 10 },
    { t: 'or', x: 86, y: 700, w: 14, h: 10 },
    { t: 'not', x: 104, y: 700, w: 20, h: 10 },
    { t: 'Pirates', x: 50, y: 650, w: 40, h: 10 },
    { t: 'of', x: 94, y: 650, w: 12, h: 10 },
    { t: 'Penzance', x: 110, y: 650, w: 50, h: 10 },
  ],
  lines: [
    [0, 1, 2, 3],
    [4, 5, 6],
  ],
}

const placeCue = vi.fn(async () => {})
const placeCueRange = vi.fn(async () => {})
let snap = true

function mountSession() {
  h.session = {
    versionId: 'v1',
    snap,
    cueTarget: { departmentId: 'lx' },
    annotationTarget: { disabled: 'no layer' },
    departments: [{ id: 'lx', code: 'LX', colour: '#F5A623', sort_order: 0 }],
    view: { cuesByPage: new Map(), annotationsByPage: new Map() },
    markerSide: () => 'left',
    layerColour: () => '#888888',
    stamps: [],
    hover: { current: null },
    canEditCue: () => true,
    canEditAnnotation: () => true,
    placeCue,
    placeCueRange,
  }
}

function mount() {
  mountSession()
  const view = render(
    <div data-page-index="0">
      <svg aria-label="Page 1 markup">
        <MarkupOverlay page={page} words={words} zoom={1} />
      </svg>
    </div>,
  )
  const sheet = view.container.querySelector('[data-page-index]') as HTMLElement
  // A 600 x 800 page drawn at 1:1 at the viewport's origin; client y runs down, page y runs up.
  sheet.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 }) as DOMRect
  const surface = view.container.querySelector('rect.markup-surface') as SVGRectElement
  const group = view.container.querySelector('g.markup-overlay') as SVGGElement
  return { ...view, surface, group }
}

/** A pointer event as the handlers read it (jsdom has no PointerEvent). */
function pointer(type: string, x: number, y: number, target: EventTarget) {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  act(() => {
    target.dispatchEvent(ev)
  })
}

/** Page point (x, y up) to a client point. */
const client = (x: number, y: number) => ({ x, y: 800 - y })

/** A full press, drag and release the way a browser delivers it, with the click that follows. */
function dragAndClick(surface: SVGRectElement, from: [number, number], to: [number, number]) {
  const a = client(...from)
  const b = client(...to)
  pointer('pointerdown', a.x, a.y, surface)
  pointer('pointermove', b.x, b.y, window)
  pointer('pointerup', b.x, b.y, window)
  fireEvent.click(surface, { clientX: b.x, clientY: b.y })
}

beforeEach(() => {
  snap = true
  placeCue.mockClear()
  placeCueRange.mockClear()
  setTool('cue', 'go')
  setCueMark('underline')
})
afterEach(() => {
  cleanup()
  endRelocate()
  setTool('select', 'go')
})

test('a click with the cue tool places an underline cue, with the current mark', () => {
  const { surface } = mount()
  fireEvent.click(surface, { clientX: 70, clientY: 98 })
  expect(placeCue).toHaveBeenCalledTimes(1)
  expect(placeCue).toHaveBeenCalledWith(0, { x: 70, y: 702 }, 'go', words, 'underline')
  expect(placeCueRange).not.toHaveBeenCalled()
})

test('a click places with the mark chosen in the flyout', () => {
  setCueMark('line')
  const { surface } = mount()
  fireEvent.click(surface, { clientX: 70, clientY: 98 })
  expect(placeCue).toHaveBeenCalledWith(0, { x: 70, y: 702 }, 'go', words, 'line')
})

for (const mark of ['underline', 'highlight'] as const) {
  test(`a drag with the cue tool (${mark}) places exactly one cue (the click that follows the drag places none)`, () => {
    setCueMark(mark)
    const { surface } = mount()
    // From "be" (word 1) down to "of" (word 5).
    dragAndClick(surface, [75, 705], [100, 655])
    expect(placeCueRange).toHaveBeenCalledTimes(1)
    expect(placeCueRange).toHaveBeenCalledWith(
      0,
      { quote: 'be or not Pirates of', wordStart: 1, wordEnd: 5 },
      'go',
      mark,
      words,
    )
    expect(placeCue).not.toHaveBeenCalled()
    // The next, separate click places as usual.
    fireEvent.click(surface, { clientX: 70, clientY: 98 })
    expect(placeCue).toHaveBeenCalledTimes(1)
  })
}

test('with Snap off a drag selects no range: the click places the one unbound cue', () => {
  snap = false
  const { surface, container } = mount()
  const a = client(75, 705)
  const b = client(100, 655)
  pointer('pointerdown', a.x, a.y, surface)
  pointer('pointermove', b.x, b.y, window)
  expect(container.querySelector('rect.cue-range-preview')).toBeNull()
  pointer('pointerup', b.x, b.y, window)
  fireEvent.click(surface, { clientX: b.x, clientY: b.y })
  expect(placeCueRange).not.toHaveBeenCalled()
  // One cue, placed at the release point through the click path (snap off gives it no text).
  expect(placeCue).toHaveBeenCalledTimes(1)
  expect(placeCue).toHaveBeenCalledWith(0, { x: 100, y: 655 }, 'go', words, 'underline')
})

test('a press and release without a drag still places through the click', () => {
  const { surface } = mount()
  pointer('pointerdown', 70, 98, surface)
  pointer('pointerup', 70, 98, window)
  fireEvent.click(surface, { clientX: 70, clientY: 98 })
  expect(placeCue).toHaveBeenCalledTimes(1)
  expect(placeCueRange).not.toHaveBeenCalled()
})

test('a drag shows a preview of the words in the department colour while it is under way', () => {
  const { surface, container } = mount()
  const a = client(75, 705)
  const b = client(100, 655)
  pointer('pointerdown', a.x, a.y, surface)
  expect(container.querySelector('.cue-range-preview')).toBeNull()
  pointer('pointermove', b.x, b.y, window)
  const boxes = [...container.querySelectorAll('rect.cue-range-preview')]
  expect(boxes).toHaveLength(2)
  expect(boxes[0]?.getAttribute('fill')).toBe('#F5A623')
  pointer('pointerup', b.x, b.y, window)
})

test('line and pointer marks do not drag a range: a drag places nothing, the click places', () => {
  setCueMark('line')
  const { surface } = mount()
  dragAndClick(surface, [75, 705], [100, 655])
  expect(placeCueRange).not.toHaveBeenCalled()
})

test('with the line mark a ghost bar follows the pointer, snapped to the caret, in the department colour', () => {
  setCueMark('line')
  const { surface, container } = mount()
  expect(container.querySelector('line.cue-caret-ghost')).toBeNull()
  fireEvent.pointerMove(surface, { clientX: 90, clientY: 98 })
  const ghost = container.querySelector('line.cue-caret-ghost') as SVGLineElement
  expect(ghost).not.toBeNull()
  expect(ghost.getAttribute('stroke')).toBe('#F5A623')
  expect(ghost.style.pointerEvents).toBe('none')
  expect(Number(ghost.getAttribute('opacity'))).toBeLessThan(1)
  // On the line at y 705, not at the pointer's 702.
  const ys = [Number(ghost.getAttribute('y1')), Number(ghost.getAttribute('y2'))]
  expect(Math.min(...ys)).toBeLessThan(705)
  expect(Math.max(...ys)).toBeGreaterThan(705)
  expect(ghost.getAttribute('x1')).toBe(ghost.getAttribute('x2'))
})

test('no ghost for underline or highlight, with snap off, away from every line, or off the page', () => {
  const near = { clientX: 90, clientY: 98 }
  setCueMark('highlight')
  let view = mount()
  fireEvent.pointerMove(view.surface, near)
  expect(view.container.querySelector('line.cue-caret-ghost')).toBeNull()
  cleanup()

  setCueMark('pointer')
  snap = false
  view = mount()
  fireEvent.pointerMove(view.surface, near)
  expect(view.container.querySelector('line.cue-caret-ghost')).toBeNull()
  cleanup()

  snap = true
  view = mount()
  fireEvent.pointerMove(view.surface, near)
  expect(view.container.querySelector('line.cue-caret-ghost')).not.toBeNull()
  fireEvent.pointerMove(view.surface, { clientX: 90, clientY: 300 })
  expect(view.container.querySelector('line.cue-caret-ghost')).toBeNull()
  fireEvent.pointerMove(view.surface, near)
  fireEvent.pointerLeave(view.group)
  expect(view.container.querySelector('line.cue-caret-ghost')).toBeNull()
})

test('no line ghost while a cue is being relocated: the click will not use the cue tool mark', () => {
  setCueMark('line')
  const { surface, container } = mount()
  fireEvent.pointerMove(surface, { clientX: 90, clientY: 98 })
  expect(container.querySelector('line.cue-caret-ghost')).not.toBeNull()
  act(() => startRelocate('cues', 'c1'))
  fireEvent.pointerMove(surface, { clientX: 90, clientY: 98 })
  expect(container.querySelector('line.cue-caret-ghost')).toBeNull()
})
