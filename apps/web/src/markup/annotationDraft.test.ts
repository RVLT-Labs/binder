import { describe, expect, test } from 'vitest'
import { draftToAnnotation } from './annotationDraft'

describe('draftToAnnotation', () => {
  test('a rect dragged up and left is normalised to its bottom-left corner', () =>
    expect(draftToAnnotation('rect', { x: 200, y: 500 }, { x: 150, y: 450 })).toEqual({
      anchor: { x: 150, y: 450 },
      geometry: { w: 50, h: 50 },
    }))

  test('an ellipse is the same box', () =>
    expect(draftToAnnotation('ellipse', { x: 10, y: 10 }, { x: 40, y: 30 })).toEqual({
      anchor: { x: 10, y: 10 },
      geometry: { w: 30, h: 20 },
    }))

  test('tiny drags make nothing', () => {
    expect(draftToAnnotation('rect', { x: 10, y: 10 }, { x: 11, y: 50 })).toBeNull()
    expect(draftToAnnotation('rect', { x: 10, y: 10 }, { x: 50, y: 11.9 })).toBeNull()
    expect(draftToAnnotation('ellipse', { x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull()
    expect(draftToAnnotation('line', { x: 10, y: 10 }, { x: 11, y: 10 })).toBeNull()
    expect(draftToAnnotation('arrow', { x: 10, y: 10 }, { x: 10.5, y: 10.5 })).toBeNull()
  })

  test('a drag of exactly two points is enough', () => {
    expect(draftToAnnotation('rect', { x: 0, y: 0 }, { x: 2, y: 2 })).not.toBeNull()
    expect(draftToAnnotation('line', { x: 0, y: 0 }, { x: 2, y: 0 })).not.toBeNull()
  })

  test('an arrow keeps its start as the anchor', () =>
    expect(draftToAnnotation('arrow', { x: 300, y: 200 }, { x: 250, y: 260 })).toEqual({
      anchor: { x: 300, y: 200 },
      geometry: { dx: -50, dy: 60 },
    }))

  test('a line is measured by its length', () =>
    expect(draftToAnnotation('line', { x: 0, y: 0 }, { x: 1.5, y: 1.5 })).toEqual({
      anchor: { x: 0, y: 0 },
      geometry: { dx: 1.5, dy: 1.5 },
    }))

  test('a note, a stamp and a highlight anchor at the start and carry no geometry', () => {
    for (const tool of ['note', 'stamp', 'highlight'] as const) {
      expect(draftToAnnotation(tool, { x: 12, y: 34 }, { x: 99, y: 99 })).toEqual({
        anchor: { x: 12, y: 34 },
        geometry: {},
      })
    }
  })
})
