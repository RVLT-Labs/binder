import { expect, test, vi } from 'vitest'

vi.mock('@powersync/react', () => ({ useQuery: () => ({ data: [] }) }))
vi.mock('../markup/wordLayers', () => ({ useWordLayer: () => null }))

import { REVIEW_WINDOW, windowOffset } from './ReviewThumb'

const page = { width: 160, height: 207 }

test('the window is the mockup 84 x 48', () => {
  expect(REVIEW_WINDOW).toEqual({ width: 84, height: 48 })
})

test('the window is centred on the anchor', () => {
  expect(windowOffset({ left: 80, top: 100 }, page)).toEqual({ left: 38, top: 76 })
})

test('it never leaves the image: a point near a corner pins the window to the edge', () => {
  expect(windowOffset({ left: 3, top: 2 }, page)).toEqual({ left: 0, top: 0 })
  expect(windowOffset({ left: 158, top: 205 }, page)).toEqual({ left: 76, top: 159 })
})

test('an image smaller than the window sits at the origin', () => {
  expect(windowOffset({ left: 10, top: 10 }, { width: 50, height: 30 })).toEqual({
    left: 0,
    top: 0,
  })
})
