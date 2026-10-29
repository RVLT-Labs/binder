import type { WordLayer } from '@binder/shared'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PageRow } from '../powersync/schema'
import { MarkupOverlay } from './MarkupOverlay'
import { endRelocate, startRelocate } from './relocate'
import { clearSelection, select } from './selection'
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
/** Who hears a bubble write, as the real session tells them (the overlay forgets a nudge a reset overrides). */
const bubbleListeners = new Set<(id: string, from?: 'nudge') => void>()
const setBubble = vi.fn(async (id: string, _tag: unknown, from?: 'nudge') => {
  for (const fn of [...bubbleListeners]) fn(id, from)
})
const moveCue = vi.fn(async () => {})
const placeCueRange = vi.fn(async () => {})
let snap = true
let cueSize: 'normal' | 'large' = 'normal'

function mountSession(cues: unknown[] = []) {
  h.session = {
    versionId: 'v1',
    snap,
    cueTarget: { departmentId: 'lx' },
    annotationTarget: { disabled: 'no layer' },
    departments: [{ id: 'lx', code: 'LX', colour: '#F5A623', sort_order: 0 }],
    view: {
      cuesByPage: new Map(cues.length ? [[0, cues]] : []),
      annotationsByPage: new Map(),
    },
    pages: [page],
    markerSide: () => 'left',
    connectorStyle: () => ({ width: 'thin', pattern: 'solid' }),
    cueSize: () => cueSize,
    layerColour: () => '#888888',
    stamps: [],
    hover: { current: null },
    canEditCue: () => true,
    canEditAnnotation: () => true,
    placeCue,
    placeCueRange,
    setBubble,
    subscribeBubbleWrites: (fn: (id: string, from?: 'nudge') => void) => {
      bubbleListeners.add(fn)
      return () => void bubbleListeners.delete(fn)
    },
    moveCue,
  }
}

function mount(cues: unknown[] = []) {
  mountSession(cues)
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
function pointer(type: string, x: number, y: number, target: EventTarget, pointerType?: string) {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  if (pointerType) Object.defineProperty(ev, 'pointerType', { value: pointerType })
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
  cueSize = 'normal'
  placeCue.mockClear()
  placeCueRange.mockClear()
  setBubble.mockClear()
  moveCue.mockClear()
  setTool('cue', 'go')
  setCueMark('underline')
})
afterEach(() => {
  cleanup()
  endRelocate()
  clearSelection()
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

describe('Auto: the gesture picks the mark', () => {
  beforeEach(() => setCueMark('auto'))

  test('a click places a line', () => {
    const { surface } = mount()
    fireEvent.click(surface, { clientX: 70, clientY: 98 })
    expect(placeCue).toHaveBeenCalledTimes(1)
    expect(placeCue).toHaveBeenCalledWith(0, { x: 70, y: 702 }, 'go', words, 'line')
    expect(placeCueRange).not.toHaveBeenCalled()
  })

  test('a press and release without a drag is a click: a line', () => {
    const { surface } = mount()
    pointer('pointerdown', 70, 98, surface)
    pointer('pointerup', 70, 98, window)
    fireEvent.click(surface, { clientX: 70, clientY: 98 })
    expect(placeCue).toHaveBeenCalledTimes(1)
    expect(placeCue).toHaveBeenCalledWith(0, { x: 70, y: 702 }, 'go', words, 'line')
    expect(placeCueRange).not.toHaveBeenCalled()
  })

  test('a drag over words places one highlight on them, and the click that follows places none', () => {
    const { surface } = mount()
    // From "be" (word 1) down to "of" (word 5).
    dragAndClick(surface, [75, 705], [100, 655])
    expect(placeCueRange).toHaveBeenCalledTimes(1)
    expect(placeCueRange).toHaveBeenCalledWith(
      0,
      { quote: 'be or not Pirates of', wordStart: 1, wordEnd: 5 },
      'go',
      'highlight',
      words,
    )
    expect(placeCue).not.toHaveBeenCalled()
    // The next, separate click is a line again.
    fireEvent.click(surface, { clientX: 70, clientY: 98 })
    expect(placeCue).toHaveBeenCalledWith(0, { x: 70, y: 702 }, 'go', words, 'line')
  })

  test('a drag across a single word highlights that one word', () => {
    const { surface } = mount()
    dragAndClick(surface, [88, 705], [97, 705])
    expect(placeCueRange).toHaveBeenCalledWith(
      0,
      { quote: 'or', wordStart: 2, wordEnd: 2 },
      'go',
      'highlight',
      words,
    )
  })

  test('a finger keeps its scroll: a touch drag selects nothing and the click places a line', () => {
    const { surface } = mount()
    const a = client(75, 705)
    const b = client(100, 655)
    pointer('pointerdown', a.x, a.y, surface, 'touch')
    pointer('pointermove', b.x, b.y, window, 'touch')
    pointer('pointerup', b.x, b.y, window, 'touch')
    fireEvent.click(surface, { clientX: b.x, clientY: b.y })
    expect(placeCueRange).not.toHaveBeenCalled()
    expect(placeCue).toHaveBeenCalledWith(0, { x: 100, y: 655 }, 'go', words, 'line')
  })

  test('with Snap off a drag selects no range: the click places a free line', () => {
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
    expect(placeCue).toHaveBeenCalledWith(0, { x: 100, y: 655 }, 'go', words, 'line')
  })

  test('the ghost bar shows where a click would put the line, and gives way to the drag preview', () => {
    const { surface, container } = mount()
    fireEvent.pointerMove(surface, { clientX: 90, clientY: 98 })
    expect(container.querySelector('line.cue-caret-ghost')).not.toBeNull()
    const a = client(75, 705)
    const b = client(100, 655)
    pointer('pointerdown', a.x, a.y, surface)
    pointer('pointermove', b.x, b.y, window)
    expect(container.querySelectorAll('rect.cue-range-preview')).toHaveLength(2)
    // The pointer moves over the surface during the drag too: no bar beside the preview.
    fireEvent.pointerMove(surface, { clientX: b.x, clientY: b.y })
    expect(container.querySelector('line.cue-caret-ghost')).toBeNull()
    pointer('pointerup', b.x, b.y, window)
  })
})

test('the timer that keeps a dropped range on screen does not outlive the page', async () => {
  // A timer left running after the page is gone fires after the test environment is torn down and
  // fails the whole run with "window is not defined" (it did in CI).
  vi.useFakeTimers()
  try {
    const { surface, unmount } = mount()
    dragAndClick(surface, [75, 705], [100, 655])
    expect(placeCueRange).toHaveBeenCalledTimes(1)
    // let the write settle: the preview is then kept for a moment by a timer
    await act(async () => {
      await Promise.resolve()
    })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
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

/** A cue on "or" (page y 705) in the left margin: its pill is at the margin, level with it. */
const placed = {
  id: 'c1',
  department_id: 'lx',
  type: 'go',
  label: 'Sunrise',
  major: 10,
  minor: 0,
  dept_code: 'LX',
  dept_colour: '#F5A623',
  dept_number_format: 'decimal',
  anchor: {
    pageIndex: 0,
    x: 86,
    y: 705,
    status: 'ok',
    text: { quote: 'or', wordStart: 2, wordEnd: 2 },
  },
}

const sheetJsx = () => (
  <div data-page-index="0">
    <svg aria-label="Page 1 markup">
      <MarkupOverlay page={page} words={words} zoom={1} />
    </svg>
  </div>
)

/** The tag the last `setBubble` call wrote. */
const tagWritten = () => {
  const call = setBubble.mock.calls.at(-1) as unknown as [string, { dx: number; dy: number }]
  return call[1]
}

/** Where the document's elements-at-point say the page is: the sheet, or nothing when off the page. */
function pageUnderPointer(container: HTMLElement, over: boolean) {
  const sheet = container.querySelector('[data-page-index]') as HTMLElement
  document.elementsFromPoint = () => (over ? [sheet] : [])
}

function pillCentre(container: HTMLElement) {
  const body = container.querySelector('[data-cue-id="c1"] rect.cue-tag-body') as SVGRectElement
  const n = (k: string) => Number(body.getAttribute(k))
  return { x: n('x') + n('width') / 2, y: n('y') + n('height') / 2 }
}

describe('dragging a cue bubble', () => {
  beforeEach(() => setTool('select', 'go'))

  test("dragging a selected cue's bubble writes a tag from the drop point and does not change the anchor's x, y or text", () => {
    select('cues', 'c1')
    const view = mount([placed])
    const { container } = view
    const sheetWith = () => (
      <div data-page-index="0">
        <svg aria-label="Page 1 markup">
          <MarkupOverlay page={page} words={words} zoom={1} />
        </svg>
      </div>
    )
    pageUnderPointer(container, true)
    const marker = container.querySelector('[data-cue-id="c1"]') as SVGGElement
    const centre = pillCentre(container)
    // Pick the pill up 3 points right of and 2 below its centre, and drop it at page (300, 400).
    const down = client(centre.x + 3, centre.y - 2)
    pointer('pointerdown', down.x, down.y, marker)
    const to = client(300, 400)
    pointer('pointermove', to.x, to.y, window)
    // While dragging, a preview pill shows where it will land and nothing is written yet.
    const preview = container.querySelector(
      '.cue-bubble-preview rect.cue-tag-body',
    ) as SVGRectElement
    expect(preview).not.toBeNull()
    expect(
      Number(preview.getAttribute('x')) + Number(preview.getAttribute('width')) / 2,
    ).toBeCloseTo(297)
    expect(setBubble).not.toHaveBeenCalled()
    pointer('pointerup', to.x, to.y, window)
    // The pill's centre lands at the pointer less the grab offset: (297, 402), relative to (86, 705).
    expect(setBubble).toHaveBeenCalledTimes(1)
    expect(tagWritten()).toEqual({ dx: 211, dy: -303 })
    // The cue itself is not moved.
    expect(moveCue).not.toHaveBeenCalled()
    // The preview stays until the stored cue shows the new tag, so the pill never jumps back.
    expect(container.querySelector('.cue-bubble-preview')).not.toBeNull()
    mountSession([{ ...placed, anchor: { ...placed.anchor, tag: { dx: 211, dy: -303 } } }])
    view.rerender(sheetWith())
    expect(container.querySelector('.cue-bubble-preview')).toBeNull()
    expect(container.querySelector('.cue-drag-ghost')).toBeNull()
    expect(document.querySelector('.cue-drag-ghost')).toBeNull()
  })

  test("a large department's bubble is drawn large, grabbed by its larger pill, and its drag preview is large too", () => {
    cueSize = 'large'
    select('cues', 'c1')
    const { container } = mount([placed])
    pageUnderPointer(container, true)
    const body = container.querySelector('[data-cue-id="c1"] rect.cue-tag-body') as SVGRectElement
    expect(Number(body.getAttribute('height'))).toBeCloseTo(18.2)
    expect(Number(body.getAttribute('rx'))).toBeCloseTo(9.1)
    const marker = container.querySelector('[data-cue-id="c1"]') as SVGGElement
    const centre = pillCentre(container)
    // Grab 8 points above the centre: inside a large pill (half height 9.1), outside a normal one.
    const down = client(centre.x, centre.y + 8)
    pointer('pointerdown', down.x, down.y, marker)
    // Drag towards the top right corner: the preview is held on the page by its large size.
    const to = client(598, 798)
    pointer('pointermove', to.x, to.y, window)
    const preview = container.querySelector(
      '.cue-bubble-preview rect.cue-tag-body',
    ) as SVGRectElement
    const n = (k: string) => Number(preview.getAttribute(k))
    expect(n('height')).toBeCloseTo(18.2)
    expect(n('x') + n('width')).toBeLessThanOrEqual(600 + 1e-9)
    expect(n('y') + n('height')).toBeLessThanOrEqual(800 + 1e-9)
    pointer('pointerup', to.x, to.y, window)
    expect(setBubble).toHaveBeenCalledTimes(1)
  })

  test('a finger needs about 8 px to drag a bubble, so a tap that drifts a little moves nothing; a mouse needs 3 px', () => {
    select('cues', 'c1')
    const { container } = mount([placed])
    pageUnderPointer(container, true)
    const marker = container.querySelector('[data-cue-id="c1"]') as SVGGElement
    const centre = pillCentre(container)
    const down = client(centre.x, centre.y)
    // A touch that drifts 5 px and lifts: a tap.
    pointer('pointerdown', down.x, down.y, marker, 'touch')
    pointer('pointermove', down.x + 5, down.y, window, 'touch')
    expect(container.querySelector('.cue-bubble-preview')).toBeNull()
    pointer('pointerup', down.x + 5, down.y, window, 'touch')
    expect(setBubble).not.toHaveBeenCalled()
    // Past 8 px it is a drag.
    pointer('pointerdown', down.x, down.y, marker, 'touch')
    pointer('pointermove', down.x + 9, down.y, window, 'touch')
    expect(container.querySelector('.cue-bubble-preview')).not.toBeNull()
    pointer('pointerup', down.x + 9, down.y, window, 'touch')
    expect(setBubble).toHaveBeenCalledTimes(1)
    setBubble.mockClear()
    // A mouse starts at 3 px.
    pointer('pointerdown', down.x, down.y, marker, 'mouse')
    pointer('pointermove', down.x + 5, down.y, window, 'mouse')
    expect(container.querySelector('.cue-bubble-preview')).not.toBeNull()
    pointer('pointerup', down.x + 5, down.y, window, 'mouse')
    expect(setBubble).toHaveBeenCalledTimes(1)
  })

  test('a drop outside the page writes nothing', () => {
    select('cues', 'c1')
    const { container } = mount([placed])
    pageUnderPointer(container, false)
    const marker = container.querySelector('[data-cue-id="c1"]') as SVGGElement
    const centre = pillCentre(container)
    const down = client(centre.x, centre.y)
    pointer('pointerdown', down.x, down.y, marker)
    pointer('pointermove', 700, 300, window)
    pointer('pointerup', 700, 300, window)
    expect(setBubble).not.toHaveBeenCalled()
    expect(moveCue).not.toHaveBeenCalled()
  })

  test('an unselected bubble does not drag: it only selects', () => {
    const { container } = mount([placed])
    pageUnderPointer(container, true)
    const marker = container.querySelector('[data-cue-id="c1"]') as SVGGElement
    const centre = pillCentre(container)
    const down = client(centre.x, centre.y)
    pointer('pointerdown', down.x, down.y, marker)
    pointer('pointermove', 300, 300, window)
    expect(container.querySelector('.cue-bubble-preview')).toBeNull()
    pointer('pointerup', 300, 300, window)
    expect(setBubble).not.toHaveBeenCalled()
    expect(marker.getAttribute('aria-pressed')).toBe('true')
  })

  describe('arrow-key nudges are coalesced', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    const pause = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
    const markerOf = (container: HTMLElement) =>
      container.querySelector('[data-cue-id="c1"]') as SVGGElement
    /** Mounts the page again with other stored cues, as a sync from the database would. */
    const resync = (view: ReturnType<typeof mount>, cues: unknown[]) => {
      mountSession(cues)
      view.rerender(sheetJsx())
    }

    test('presses draw at once and are written once, 300 ms after the last, as the summed offset from where the bubble is drawn', () => {
      select('cues', 'c1')
      const view = mount([placed])
      const marker = markerOf(view.container)
      const c = pillCentre(view.container)
      for (let i = 0; i < 5; i += 1) fireEvent.keyDown(marker, { key: 'ArrowDown', altKey: true })
      fireEvent.keyDown(marker, { key: 'ArrowRight', altKey: true, shiftKey: true })
      // Drawn at the target already; nothing written yet.
      expect(pillCentre(view.container).y).toBeCloseTo(c.y - 5, 1)
      expect(pillCentre(view.container).x).toBeCloseTo(c.x + 10, 1)
      expect(setBubble).not.toHaveBeenCalled()
      pause(299)
      expect(setBubble).not.toHaveBeenCalled()
      pause(1)
      expect(setBubble).toHaveBeenCalledTimes(1)
      expect(tagWritten().dx).toBeCloseTo(c.x + 10 - 86, 1)
      expect(tagWritten().dy).toBeCloseTo(c.y - 5 - 705, 1)
      pause(5000)
      expect(setBubble).toHaveBeenCalledTimes(1)
    })

    test('a later press restarts the wait, so a held key is one write', () => {
      select('cues', 'c1')
      const view = mount([placed])
      const marker = markerOf(view.container)
      for (let i = 0; i < 20; i += 1) {
        fireEvent.keyDown(marker, { key: 'ArrowUp', altKey: true })
        pause(100)
      }
      expect(setBubble).not.toHaveBeenCalled()
      pause(300)
      expect(setBubble).toHaveBeenCalledTimes(1)
    })

    test('a stored tag that changes between presses neither loses nor undoes a step', () => {
      select('cues', 'c1')
      const view = mount([placed])
      const marker = markerOf(view.container)
      const c = pillCentre(view.container)
      fireEvent.keyDown(marker, { key: 'ArrowDown', altKey: true })
      pause(300)
      expect(setBubble).toHaveBeenCalledTimes(1)
      const first = tagWritten()
      // The first write lands and the row now holds it; two more presses follow.
      resync(view, [{ ...placed, anchor: { ...placed.anchor, tag: first } }])
      fireEvent.keyDown(marker, { key: 'ArrowDown', altKey: true })
      // Another stored change arrives in the middle of the burst (a peer, or the earlier write again).
      resync(view, [{ ...placed, anchor: { ...placed.anchor, tag: { dx: 5, dy: 5 } } }])
      fireEvent.keyDown(marker, { key: 'ArrowDown', altKey: true })
      pause(300)
      expect(setBubble).toHaveBeenCalledTimes(2)
      // The burst builds on the first write: two more steps down, never back up or lost.
      expect(tagWritten().dx).toBeCloseTo(c.x - 86, 1)
      expect(tagWritten().dy).toBeCloseTo(c.y - 3 - 705, 1)
    })

    test('the entry is dropped once the stored tag catches up, so a later nudge starts from the stored one', () => {
      select('cues', 'c1')
      const view = mount([placed])
      const marker = markerOf(view.container)
      fireEvent.keyDown(marker, { key: 'ArrowDown', altKey: true })
      pause(300)
      const written = tagWritten()
      resync(view, [{ ...placed, anchor: { ...placed.anchor, tag: written } }])
      // A peer then moves the bubble elsewhere; the next press goes from there.
      resync(view, [{ ...placed, anchor: { ...placed.anchor, tag: { dx: 100, dy: -50 } } }])
      fireEvent.keyDown(marker, { key: 'ArrowUp', altKey: true })
      pause(300)
      expect(tagWritten().dx).toBeCloseTo(100, 1)
      expect(tagWritten().dy).toBeCloseTo(-49, 1)
    })

    test('a drag that starts after a nudge was written draws the dragged bubble, not the stale nudge target', () => {
      select('cues', 'c1')
      const view = mount([placed])
      pageUnderPointer(view.container, true)
      const marker = markerOf(view.container)
      for (let i = 0; i < 4; i += 1) fireEvent.keyDown(marker, { key: 'ArrowDown', altKey: true })
      pause(300)
      expect(setBubble).toHaveBeenCalledTimes(1)
      const c = pillCentre(view.container)
      // The nudge's write has not come back yet when the bubble is picked up and dropped elsewhere.
      const down = client(c.x, c.y)
      pointer('pointerdown', down.x, down.y, marker)
      const to = client(300, 400)
      pointer('pointermove', to.x, to.y, window)
      pointer('pointerup', to.x, to.y, window)
      expect(setBubble).toHaveBeenCalledTimes(2)
      const dropped = tagWritten()
      // The row now holds the drop; the nudge's own write never shows up as the stored tag.
      resync(view, [{ ...placed, anchor: { ...placed.anchor, tag: dropped } }])
      pause(100)
      expect(pillCentre(view.container).x).toBeCloseTo(300, 1)
      expect(pillCentre(view.container).y).toBeCloseTo(400, 1)
    })

    test('Reset to margin right after a nudge draws the bubble in the margin at once, not at the stale target', () => {
      select('cues', 'c1')
      const view = mount([placed])
      const marker = markerOf(view.container)
      const margin = pillCentre(view.container)
      for (let i = 0; i < 4; i += 1) fireEvent.keyDown(marker, { key: 'ArrowDown', altKey: true })
      pause(300)
      expect(setBubble).toHaveBeenCalledTimes(1)
      expect(pillCentre(view.container).y).toBeCloseTo(margin.y - 4, 1)
      // The cue editor's button: the session clears the tag (the row never held the nudge).
      act(() => void setBubble('c1', null))
      resync(view, [placed])
      pause(100)
      expect(pillCentre(view.container)).toEqual(margin)
    })

    test('blur writes the pending nudge at once', () => {
      select('cues', 'c1')
      const view = mount([placed])
      const marker = markerOf(view.container)
      fireEvent.keyDown(marker, { key: 'ArrowLeft', altKey: true })
      expect(setBubble).not.toHaveBeenCalled()
      fireEvent.blur(marker)
      expect(setBubble).toHaveBeenCalledTimes(1)
      pause(1000)
      expect(setBubble).toHaveBeenCalledTimes(1)
    })

    test('deselecting writes it, and so does unmounting and the page being hidden or closed', () => {
      select('cues', 'c1')
      let view = mount([placed])
      fireEvent.keyDown(markerOf(view.container), { key: 'ArrowLeft', altKey: true })
      act(() => clearSelection())
      expect(setBubble).toHaveBeenCalledTimes(1)
      cleanup()

      setBubble.mockClear()
      select('cues', 'c1')
      view = mount([placed])
      fireEvent.keyDown(markerOf(view.container), { key: 'ArrowLeft', altKey: true })
      view.unmount()
      expect(setBubble).toHaveBeenCalledTimes(1)

      setBubble.mockClear()
      view = mount([placed])
      fireEvent.keyDown(markerOf(view.container), { key: 'ArrowLeft', altKey: true })
      act(() => void window.dispatchEvent(new Event('pagehide')))
      expect(setBubble).toHaveBeenCalledTimes(1)
      view.unmount()
      expect(setBubble).toHaveBeenCalledTimes(1)

      setBubble.mockClear()
      view = mount([placed])
      fireEvent.keyDown(markerOf(view.container), { key: 'ArrowLeft', altKey: true })
      const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      act(() => void document.dispatchEvent(new Event('visibilitychange')))
      state.mockRestore()
      expect(setBubble).toHaveBeenCalledTimes(1)
    })

    test('a bubble with a stored tag is drawn at the offset, and the nudge starts from there', () => {
      select('cues', 'c1')
      const tagged = { ...placed, anchor: { ...placed.anchor, tag: { dx: 100, dy: -50 } } }
      const { container } = mount([tagged])
      const c = pillCentre(container)
      expect(c.x).toBeCloseTo(186)
      expect(c.y).toBeCloseTo(655)
      fireEvent.keyDown(markerOf(container), { key: 'ArrowUp', altKey: true })
      pause(300)
      expect(tagWritten().dx).toBeCloseTo(100, 1)
      expect(tagWritten().dy).toBeCloseTo(-49, 1)
    })

    test('plain arrows on a selected, focused bubble are not intercepted: they reach the viewer and write nothing', () => {
      select('cues', 'c1')
      const view = mount([placed])
      const marker = markerOf(view.container)
      const c = pillCentre(view.container)
      // The viewer's key handler sits above the overlay; this stands in for it.
      const viewer = vi.fn()
      document.addEventListener('keydown', viewer)
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) {
        expect(fireEvent.keyDown(marker, { key })).toBe(true)
        expect(fireEvent.keyDown(marker, { key, shiftKey: true })).toBe(true)
      }
      document.removeEventListener('keydown', viewer)
      expect(viewer).toHaveBeenCalledTimes(8)
      pause(2000)
      expect(setBubble).not.toHaveBeenCalled()
      expect(pillCentre(view.container)).toEqual(c)
      // The same key with Alt nudges, and is kept from the viewer.
      document.addEventListener('keydown', viewer)
      viewer.mockClear()
      expect(fireEvent.keyDown(marker, { key: 'ArrowRight', altKey: true })).toBe(false)
      document.removeEventListener('keydown', viewer)
      expect(viewer).not.toHaveBeenCalled()
      pause(300)
      expect(setBubble).toHaveBeenCalledTimes(1)
    })

    test('a marker that is not selected ignores the keys', () => {
      const { container } = mount([placed])
      const c = pillCentre(container)
      expect(fireEvent.keyDown(markerOf(container), { key: 'ArrowDown', altKey: true })).toBe(true)
      pause(1000)
      expect(setBubble).not.toHaveBeenCalled()
      expect(pillCentre(container)).toEqual(c)
    })
  })

  test('a drop is measured against the cue as stored now, not as it was when the drag began', () => {
    select('cues', 'c1')
    const view = mount([placed])
    const { container } = view
    pageUnderPointer(container, true)
    const centre = pillCentre(container)
    const down = client(centre.x, centre.y)
    pointer('pointerdown', down.x, down.y, container.querySelector('[data-cue-id="c1"]') as Element)
    const to = client(300, 400)
    pointer('pointermove', to.x, to.y, window)
    // A peer moves the cue's mark 20 points right and 10 down while the bubble is held.
    mountSession([{ ...placed, anchor: { ...placed.anchor, x: 106, y: 695 } }])
    view.rerender(sheetJsx())
    pointer('pointerup', to.x, to.y, window)
    expect(tagWritten().dx).toBeCloseTo(300 - 106, 1)
    expect(tagWritten().dy).toBeCloseTo(400 - 695, 1)
  })
})

describe('dragging a cue mark', () => {
  beforeEach(() => setTool('select', 'go'))
  const cueWithMark = (mark: string) => ({ ...placed, anchor: { ...placed.anchor, mark } })

  test("a selected cue's mark starts the cross-page drag and moves the cue on drop, with the drop flag", () => {
    select('cues', 'c1')
    const { container } = mount([cueWithMark('highlight')])
    pageUnderPointer(container, true)
    const fill = container.querySelector('[data-cue-trigger="c1"] rect.cue-fill') as SVGRectElement
    const from = client(90, 705)
    pointer('pointerdown', from.x, from.y, fill)
    const to = client(100, 655)
    pointer('pointermove', to.x, to.y, window)
    expect(document.querySelector('.cue-drag-ghost')).not.toBeNull()
    pointer('pointerup', to.x, to.y, window)
    expect(moveCue).toHaveBeenCalledWith('c1', 0, { x: 100, y: 655 }, { dropped: true })
    expect(setBubble).not.toHaveBeenCalled()
    expect(document.querySelector('.cue-drag-ghost')).toBeNull()
  })

  test("an unselected cue's mark does not drag", () => {
    const { container } = mount([cueWithMark('highlight')])
    pageUnderPointer(container, true)
    const fill = container.querySelector('[data-cue-trigger="c1"] rect.cue-fill') as SVGRectElement
    const from = client(90, 705)
    pointer('pointerdown', from.x, from.y, fill)
    pointer('pointermove', 300, 300, window)
    expect(document.querySelector('.cue-drag-ghost')).toBeNull()
    pointer('pointerup', 300, 300, window)
    expect(moveCue).not.toHaveBeenCalled()
  })

  test('the mark of a selected cue has a move cursor; an unselected one does not', () => {
    const view = mount([cueWithMark('highlight')])
    const fill = () =>
      view.container.querySelector('[data-cue-trigger="c1"] rect.cue-fill') as SVGRectElement
    expect(fill().style.cursor).toBe('pointer')
    act(() => select('cues', 'c1'))
    expect(fill().style.cursor).toBe('move')
  })
})
