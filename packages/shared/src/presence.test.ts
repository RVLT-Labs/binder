import { expect, test } from 'vitest'
import {
  clientMessageSchema,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_PALETTE,
  PRESENCE_TIMEOUT_MS,
  presenceColour,
} from './presence'

const state = {
  documentId: 'doc-1',
  versionId: 'ver-1',
  pageIndex: 3,
  selection: { table: 'cues', id: 'cue-1' },
}

test('presenceColour is stable and from the palette', () => {
  expect(PRESENCE_PALETTE).toHaveLength(12)
  expect(new Set(PRESENCE_PALETTE).size).toBe(12)
  const ids = ['alice', 'bob', '0190a1b2-0000-7000-8000-000000000001', '']
  for (const id of ids) {
    expect(PRESENCE_PALETTE).toContain(presenceColour(id))
    expect(presenceColour(id)).toBe(presenceColour(id))
  }
  // FNV-1a 32 of "a" is 0xe40c292c: 3826002220 % 12 = 4.
  expect(presenceColour('a')).toBe(PRESENCE_PALETTE[4])
  // Many users spread over the palette rather than collapsing onto one colour.
  const used = new Set(Array.from({ length: 200 }, (_, i) => presenceColour(`user-${i}`)))
  expect(used.size).toBeGreaterThanOrEqual(10)
})

test('the heartbeat is well inside the timeout', () => {
  expect(PRESENCE_HEARTBEAT_MS).toBe(5000)
  expect(PRESENCE_TIMEOUT_MS).toBe(15000)
})

test('the client schema accepts a state and rejects junk', () => {
  const ok = (value: unknown) => clientMessageSchema.safeParse(value).success
  expect(ok({ type: 'state', state })).toBe(true)
  expect(
    ok({
      type: 'state',
      state: { documentId: null, versionId: null, pageIndex: null, selection: null },
    }),
  ).toBe(true)
  expect(
    ok({ type: 'state', state: { ...state, selection: { table: 'annotations', id: 'a' } } }),
  ).toBe(true)

  expect(ok(null)).toBe(false)
  expect(ok('state')).toBe(false)
  expect(ok({ type: 'hello', state })).toBe(false)
  expect(ok({ type: 'state' })).toBe(false)
  expect(ok({ type: 'state', state: { ...state, pageIndex: -1 } })).toBe(false)
  expect(ok({ type: 'state', state: { ...state, pageIndex: 1.5 } })).toBe(false)
  expect(ok({ type: 'state', state: { ...state, pageIndex: 100001 } })).toBe(false)
  expect(ok({ type: 'state', state: { ...state, pageIndex: 100000 } })).toBe(true)
  expect(ok({ type: 'state', state: { ...state, documentId: '' } })).toBe(false)
  expect(ok({ type: 'state', state: { ...state, documentId: 'x'.repeat(201) } })).toBe(false)
  expect(ok({ type: 'state', state: { ...state, documentId: 'x'.repeat(200) } })).toBe(true)
  expect(ok({ type: 'state', state: { ...state, selection: { table: 'users', id: 'u' } } })).toBe(
    false,
  )
  expect(ok({ type: 'state', state: { ...state, selection: { table: 'cues', id: '' } } })).toBe(
    false,
  )
  expect(
    ok({ type: 'state', state: { ...state, selection: { table: 'cues', id: 'x'.repeat(201) } } }),
  ).toBe(false)
  expect(ok({ type: 'state', state: { documentId: 'd' } })).toBe(false)
})

test('unknown fields are stripped so a client cannot smuggle data into the fan-out', () => {
  const parsed = clientMessageSchema.parse({
    type: 'state',
    state: { ...state, email: 'a@x.test' },
    extra: 1,
  })
  expect(parsed).toEqual({ type: 'state', state })
})
