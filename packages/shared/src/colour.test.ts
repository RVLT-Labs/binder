import { describe, expect, test } from 'vitest'
import { DEPARTMENT_COLOUR_PRESETS, deptChrome, isTooCloseToRed, RVLT_RED } from './colour'
import { DEFAULT_DEPARTMENTS } from './markup'

describe('deptChrome', () => {
  test('default colours map to their chrome tint', () => {
    expect(deptChrome('#C9811F')).toBe('#EBA53A')
    expect(deptChrome('#2F6BD6')).toBe('#5B8DEF')
  })
  test('is case-insensitive for defaults', () => {
    expect(deptChrome('#c9811f')).toBe('#EBA53A')
  })
  test('other colours use color-mix', () => {
    expect(deptChrome('#123456')).toBe('color-mix(in oklab, #123456 70%, white)')
  })
})

describe('isTooCloseToRed', () => {
  test('flags reds', () => {
    for (const hex of ['#E0363D', '#D0021B', '#B21F26', '#e53b40']) {
      expect(isTooCloseToRed(hex), hex).toBe(true)
    }
  })
  test('allows the defaults, coral included', () => {
    for (const hex of ['#C9811F', '#CC5E2E', '#EF7E55']) {
      expect(isTooCloseToRed(hex), hex).toBe(false)
    }
  })
  test('RVLT_RED value', () => {
    expect(RVLT_RED).toBe('#E0363D')
  })
})

describe('DEPARTMENT_COLOUR_PRESETS', () => {
  test('matches DESIGN 4.3 in order', () => {
    expect(DEPARTMENT_COLOUR_PRESETS).toEqual([
      { code: 'LX', colour: '#C9811F' },
      { code: 'SND', colour: '#2F6BD6' },
      { code: 'TM', colour: '#7A5CD0' },
      { code: 'SM', colour: '#1C8B83' },
      { code: 'VID', colour: '#C2487E' },
      { code: 'STG', colour: '#CC5E2E' },
      { code: 'FLY', colour: '#6E8C12' },
    ])
  })
  test('DEFAULT_DEPARTMENTS use the presets and none is red', () => {
    for (const d of DEFAULT_DEPARTMENTS) {
      expect(d.colour).toBe(DEPARTMENT_COLOUR_PRESETS.find((p) => p.code === d.code)?.colour)
      expect(isTooCloseToRed(d.colour)).toBe(false)
    }
  })
})
