import { expect, test } from 'vitest'
import { columnEqual, jsonEqual } from './jsonEqual'

test('jsonEqual ignores key order and columnEqual parses JSON text', () => {
  expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true)
  expect(columnEqual('{"x": 1, "y":2}', { y: 2, x: 1 })).toBe(true)
  expect(columnEqual('{"x":1}', '{"x":2}')).toBe(false)
})

test('arrays are ordered and shapes must match', () => {
  expect(jsonEqual([1, 2], [2, 1])).toBe(false)
  expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  expect(jsonEqual({ a: undefined }, { b: undefined })).toBe(false)
  expect(jsonEqual(null, {})).toBe(false)
  expect(jsonEqual([], {})).toBe(false)
})

test('columnEqual leaves plain text and nulls alone', () => {
  expect(columnEqual('go', 'go')).toBe(true)
  expect(columnEqual('go', 'warn')).toBe(false)
  expect(columnEqual(null, 'null')).toBe(false)
  expect(columnEqual('[1,2]', [1, 2])).toBe(true)
  expect(columnEqual('{broken', '{broken')).toBe(true)
})
