import { fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Handles, handlePositions } from './Handles'

test('a rect and an ellipse have four corner handles', () => {
  for (const type of ['rect', 'ellipse'] as const) {
    expect(
      handlePositions({ type, anchor: { x: 100, y: 100 }, geometry: { w: 50, h: 40 } }),
    ).toEqual([
      { handle: 'nw', x: 100, y: 140 },
      { handle: 'ne', x: 150, y: 140 },
      { handle: 'sw', x: 100, y: 100 },
      { handle: 'se', x: 150, y: 100 },
    ])
  }
})

test('a line and an arrow have a handle at each end', () => {
  for (const type of ['line', 'arrow'] as const) {
    expect(
      handlePositions({ type, anchor: { x: 10, y: 10 }, geometry: { dx: 20, dy: -5 } }),
    ).toEqual([
      { handle: 'start', x: 10, y: 10 },
      { handle: 'end', x: 30, y: 5 },
    ])
  }
})

test('notes, stamps and highlights have none', () => {
  for (const type of ['note', 'stamp', 'highlight'] as const) {
    expect(handlePositions({ type, anchor: { x: 1, y: 1 }, geometry: {} })).toEqual([])
  }
})

test('pressing a handle reports which, and a handle is as big on screen at any zoom', () => {
  const onHandleDown = vi.fn()
  const { container } = render(
    // biome-ignore lint/a11y/noSvgWithoutTitle: a test harness for overlay shapes
    <svg>
      <Handles
        annotation={{ type: 'rect', anchor: { x: 100, y: 100 }, geometry: { w: 50, h: 40 } }}
        zoom={2}
        onHandleDown={onHandleDown}
      />
    </svg>,
  )
  const handles = container.querySelectorAll('[data-handle]')
  expect(handles).toHaveLength(4)
  const se = container.querySelector('[data-handle="se"]') as Element
  // 8 CSS pixels at zoom 2 is 4 points.
  expect(se.getAttribute('width')).toBe('4')
  fireEvent.pointerDown(se, { button: 0 })
  expect(onHandleDown).toHaveBeenCalledWith('se', expect.anything())
})

test('handles are white squares with a red stroke from the tokens', () => {
  const { container } = render(
    // biome-ignore lint/a11y/noSvgWithoutTitle: a test harness for overlay shapes
    <svg>
      <Handles
        annotation={{ type: 'line', anchor: { x: 0, y: 0 }, geometry: { dx: 10, dy: 10 } }}
        zoom={1}
        onHandleDown={() => {}}
      />
    </svg>,
  )
  for (const h of container.querySelectorAll('[data-handle]')) {
    expect(h.getAttribute('stroke')).toBe('var(--red)')
    expect(h.getAttribute('fill')).toBe('var(--page)')
  }
})
