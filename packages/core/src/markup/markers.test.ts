import { expect, test } from 'vitest'
import { markerLead, markerText } from './markers'

test.each([
  ['go', 'LX 10'],
  ['standby', 'SB LX 10'],
  ['warn', 'W LX 10'],
] as const)('marker text for %s', (t, s) => expect(markerText(t, 'LX', '10')).toBe(s))

test.each([
  ['go', 'LX'],
  ['standby', 'SB LX'],
  ['warn', 'W LX'],
] as const)('the tag lead for %s is the department code with the SB or W prefix', (t, s) =>
  expect(markerLead(t, 'LX')).toBe(s),
)
