import { expect, test } from 'vitest'
import { readConnectorStyle, withConnectorStyle } from './connectorStyleSettings'

const THIN_SOLID = { width: 'thin', pattern: 'solid' }

test('a show with no connector styles reads as thin and solid, whatever the settings text is', () => {
  expect(readConnectorStyle(null, 'd1')).toEqual(THIN_SOLID)
  expect(readConnectorStyle(undefined, 'd1')).toEqual(THIN_SOLID)
  expect(readConnectorStyle('', 'd1')).toEqual(THIN_SOLID)
  expect(readConnectorStyle('not json', 'd1')).toEqual(THIN_SOLID)
  expect(readConnectorStyle('[1]', 'd1')).toEqual(THIN_SOLID)
  expect(readConnectorStyle('{"connectorStyles":"bold"}', 'd1')).toEqual(THIN_SOLID)
})

test('reads one department style from the settings text', () => {
  const text = JSON.stringify({
    connectorStyles: { d1: { width: 'bold', pattern: 'dashed' }, d2: { width: 'medium' } },
  })
  expect(readConnectorStyle(text, 'd1')).toEqual({ width: 'bold', pattern: 'dashed' })
  expect(readConnectorStyle(text, 'd2')).toEqual({ width: 'medium', pattern: 'solid' })
  expect(readConnectorStyle(text, 'd3')).toEqual(THIN_SOLID)
})

test("withConnectorStyle keeps stampSet, paperSize, markerSides and other departments' styles; reading it back gives the style", () => {
  const before = JSON.stringify({
    stampSet: ['Hold', 'Go'],
    paperSize: 'Letter',
    markerSides: { d1: 'right' },
    connectorStyles: { d2: { width: 'medium', pattern: 'dotted' } },
    timezone: 'Europe/London',
  })
  const after = withConnectorStyle(before, 'd1', { width: 'bold', pattern: 'dashed' })
  expect(JSON.parse(after)).toEqual({
    stampSet: ['Hold', 'Go'],
    paperSize: 'Letter',
    markerSides: { d1: 'right' },
    connectorStyles: {
      d2: { width: 'medium', pattern: 'dotted' },
      d1: { width: 'bold', pattern: 'dashed' },
    },
    timezone: 'Europe/London',
  })
  expect(readConnectorStyle(after, 'd1')).toEqual({ width: 'bold', pattern: 'dashed' })
  expect(readConnectorStyle(after, 'd2')).toEqual({ width: 'medium', pattern: 'dotted' })
})

test('replaces a department that already has a style and starts from empty settings', () => {
  const once = withConnectorStyle(null, 'd1', { width: 'medium', pattern: 'solid' })
  expect(JSON.parse(once)).toEqual({
    connectorStyles: { d1: { width: 'medium', pattern: 'solid' } },
  })
  const twice = withConnectorStyle(once, 'd1', { width: 'bold', pattern: 'dotted' })
  expect(JSON.parse(twice)).toEqual({
    connectorStyles: { d1: { width: 'bold', pattern: 'dotted' } },
  })
})

test('a connectorStyles that is not an object is replaced, other keys are kept', () => {
  for (const bad of ['"bold"', '[1,2]', 'null', '7']) {
    const after = withConnectorStyle(`{"paperSize":"A4","connectorStyles":${bad}}`, 'd1', {
      width: 'bold',
      pattern: 'solid',
    })
    expect(JSON.parse(after)).toEqual({
      paperSize: 'A4',
      connectorStyles: { d1: { width: 'bold', pattern: 'solid' } },
    })
  }
})
