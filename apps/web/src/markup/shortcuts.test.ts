import { expect, test } from 'vitest'
import { TOOL_DEFS } from './MarkupTools'
import { resolveShortcut, TOOL_KEYS } from './shortcuts'

const keyEvent = (key: string, o: Partial<Parameters<typeof resolveShortcut>[0]> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  editableTarget: false,
  ...o,
})

test.each([
  [']', { kind: 'nextCue' }],
  ['[', { kind: 'prevCue' }],
  ['c', { kind: 'placeCue' }],
  ['g', { kind: 'jumpToPage' }],
  ['3', { kind: 'activeLayer', index: 2 }],
  ['1', { kind: 'activeLayer', index: 0 }],
  ['Delete', { kind: 'delete' }],
  ['Backspace', { kind: 'delete' }],
  ['Escape', { kind: 'deselect' }],
])('%s maps to its action', (key, action) => {
  expect(resolveShortcut(keyEvent(key))).toEqual(action)
})

test('0 and other keys map to nothing', () => {
  for (const key of ['0', 'x', 'Enter', ' ']) expect(resolveShortcut(keyEvent(key))).toBeNull()
})

test('mod+z undoes and mod+shift+z redoes with meta or ctrl', () => {
  expect(resolveShortcut(keyEvent('z', { metaKey: true }))).toEqual({ kind: 'undo' })
  expect(resolveShortcut(keyEvent('z', { ctrlKey: true }))).toEqual({ kind: 'undo' })
  expect(resolveShortcut(keyEvent('z', { metaKey: true, shiftKey: true }))).toEqual({
    kind: 'redo',
  })
  expect(resolveShortcut(keyEvent('Z', { ctrlKey: true, shiftKey: true }))).toEqual({
    kind: 'redo',
  })
  expect(resolveShortcut(keyEvent('z'))).toBeNull()
})

test('browser shortcuts that share a letter are left alone', () => {
  expect(resolveShortcut(keyEvent('c', { metaKey: true }))).toBeNull()
  expect(resolveShortcut(keyEvent('g', { ctrlKey: true }))).toBeNull()
  expect(resolveShortcut(keyEvent('1', { altKey: true }))).toBeNull()
})

test('in an input only Escape works', () => {
  for (const key of [']', '[', 'c', 'g', '3', 'Delete', 'Backspace']) {
    expect(resolveShortcut(keyEvent(key, { editableTarget: true }))).toBeNull()
  }
  expect(resolveShortcut(keyEvent('z', { metaKey: true, editableTarget: true }))).toBeNull()
  expect(resolveShortcut(keyEvent('Escape', { editableTarget: true }))).toEqual({
    kind: 'deselect',
  })
})

test.each([
  ['v', { kind: 'tool', tool: 'select' }],
  ['h', { kind: 'tool', tool: 'highlight' }],
  ['n', { kind: 'tool', tool: 'note' }],
  ['r', { kind: 'tool', tool: 'rect' }],
  ['a', { kind: 'tool', tool: 'arrow' }],
  ['s', { kind: 'tool', tool: 'stamp' }],
  ['H', { kind: 'tool', tool: 'highlight' }],
  ['/', { kind: 'focusSearch' }],
])('%s switches the tool or finds in the document', (key, action) => {
  expect(resolveShortcut(keyEvent(key))).toEqual(action)
})

test('tool keys never fire in a text field or with a modifier', () => {
  for (const key of ['v', 'h', 'n', 'r', 'a', 's', '/']) {
    expect(resolveShortcut(keyEvent(key, { editableTarget: true }))).toBeNull()
    expect(resolveShortcut(keyEvent(key, { altKey: true }))).toBeNull()
  }
  expect(resolveShortcut(keyEvent('s', { metaKey: true }))).toBeNull()
})

test('every key the tool strip shows is a key that works', () => {
  for (const def of TOOL_DEFS) {
    if (!def.key) continue
    // `c` places a cue at the pointer; the other keys choose their tool.
    if (def.key === 'c') expect(resolveShortcut(keyEvent('c'))).toEqual({ kind: 'placeCue' })
    else expect(TOOL_KEYS[def.key]).toBe(def.tool)
  }
})
