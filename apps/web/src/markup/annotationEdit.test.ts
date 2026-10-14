import { describe, expect, test } from 'vitest'
import {
  moveBy,
  moveEndpoint,
  moveEndpointOrNull,
  resizeBox,
  resizeBoxOrNull,
} from './annotationEdit'

describe('moveBy', () => {
  test('translates the anchor and leaves geometry to the caller', () =>
    expect(moveBy({ x: 100, y: 200 }, -15, 30)).toEqual({ x: 85, y: 230 }))

  test('stays on the page when given its size', () => {
    expect(moveBy({ x: 100, y: 200 }, -500, 900, { width: 612, height: 792 })).toEqual({
      x: 0,
      y: 792,
    })
  })
})

describe('resizeBox', () => {
  const anchor = { x: 100, y: 100 }
  const geometry = { w: 50, h: 40 }

  test('resizing from the nw handle keeps the se corner fixed', () =>
    expect(resizeBox(anchor, geometry, 'nw', { x: 80, y: 160 })).toEqual({
      anchor: { x: 80, y: 100 },
      geometry: { w: 70, h: 60 },
    }))

  test('the se handle keeps the nw corner fixed', () =>
    expect(resizeBox(anchor, geometry, 'se', { x: 170, y: 70 })).toEqual({
      anchor: { x: 100, y: 70 },
      geometry: { w: 70, h: 70 },
    }))

  test('the ne handle keeps the sw corner (the anchor) fixed', () =>
    expect(resizeBox(anchor, geometry, 'ne', { x: 130, y: 180 })).toEqual({
      anchor: { x: 100, y: 100 },
      geometry: { w: 30, h: 80 },
    }))

  test('the sw handle keeps the ne corner fixed', () =>
    expect(resizeBox(anchor, geometry, 'sw', { x: 120, y: 90 })).toEqual({
      anchor: { x: 120, y: 90 },
      geometry: { w: 30, h: 50 },
    }))

  test('dragging a corner past the opposite one flips and stays positive', () => {
    // The se corner (150, 100) stays put; the nw handle goes past it to the lower right.
    expect(resizeBox(anchor, geometry, 'nw', { x: 190, y: 60 })).toEqual({
      anchor: { x: 150, y: 60 },
      geometry: { w: 40, h: 40 },
    })
  })

  test('a box under 2 points keeps its last valid size', () => {
    expect(resizeBox(anchor, geometry, 'nw', { x: 149, y: 160 })).toEqual({ anchor, geometry })
    expect(resizeBox(anchor, geometry, 'nw', { x: 80, y: 99.5 })).toEqual({ anchor, geometry })
    expect(resizeBoxOrNull(anchor, geometry, 'nw', { x: 149, y: 160 })).toBeNull()
  })
})

describe('moveEndpoint', () => {
  test('moving the end of an arrow keeps its start', () =>
    expect(moveEndpoint({ x: 10, y: 10 }, { dx: 20, dy: 0 }, 'end', { x: 40, y: 50 })).toEqual({
      anchor: { x: 10, y: 10 },
      geometry: { dx: 30, dy: 40 },
    }))

  test('moving the start keeps the end where it is', () =>
    expect(moveEndpoint({ x: 10, y: 10 }, { dx: 20, dy: 0 }, 'start', { x: 0, y: 5 })).toEqual({
      anchor: { x: 0, y: 5 },
      geometry: { dx: 30, dy: 5 },
    }))

  test('an endpoint dropped on the other one keeps the last valid line', () => {
    const anchor = { x: 10, y: 10 }
    const geometry = { dx: 20, dy: 0 }
    expect(moveEndpoint(anchor, geometry, 'end', { x: 10.5, y: 10.5 })).toEqual({
      anchor,
      geometry,
    })
    expect(moveEndpointOrNull(anchor, geometry, 'end', { x: 10.5, y: 10.5 })).toBeNull()
  })
})
