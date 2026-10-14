import { expect, test } from 'vitest'
import { cueMarkerBox, markerStyle, markerText } from './markers'

test.each([
  ['go', 'LX 10'],
  ['standby', 'SB LX 10'],
  ['warn', 'W LX 10'],
] as const)('marker text for %s', (t, s) => expect(markerText(t, 'LX', '10')).toBe(s))

test('marker style: go is solid, standby a dashed outline, warn a solid outline', () => {
  expect(markerStyle('go')).toEqual({ fill: 'solid', stroke: 'none' })
  expect(markerStyle('standby')).toEqual({ fill: 'none', stroke: 'dashed' })
  expect(markerStyle('warn')).toEqual({ fill: 'none', stroke: 'solid' })
})

test('cueMarkerBox is 14 high, centred on y, left edge at x', () => {
  expect(cueMarkerBox(100, 500, 30)).toEqual({ x: 100, y: 493, w: 38, h: 14 })
})
