import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { setCueMark, setTool, useTool } from './tools'
import { isEditableTarget, modalIsOpen, useMarkupShortcuts } from './useMarkupShortcuts'

const placeCue = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./MarkupSession', () => ({
  useMarkupSession: () => ({
    placeCue,
    hover: { current: { pageIndex: 1, point: { x: 5, y: 6 } } },
    showId: 's1',
    versionReadOnly: null,
    annotationTarget: { layer: { kind: 'department', id: 'lx' } },
    view: { ordered: [], annotationsByPage: new Map() },
    viewer: { current: null },
    editable: [],
  }),
}))
vi.mock('../undo/useUndo', () => ({
  useUndo: () => ({ undo: async () => {}, redo: async () => {} }),
}))
vi.mock('./selection', () => ({ useSelection: () => null, clearSelection: () => {} }))

const input = (type: string) => Object.assign(document.createElement('input'), { type })

test('text fields, text areas, selects, and editable content take typed keys', () => {
  for (const type of ['text', 'search', 'number', 'email'])
    expect(isEditableTarget(input(type))).toBe(true)
  expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
  expect(isEditableTarget(document.createElement('select'))).toBe(true)
  const div = document.createElement('div')
  div.contentEditable = 'true'
  // jsdom does not compute isContentEditable from the attribute.
  Object.defineProperty(div, 'isContentEditable', { value: true })
  expect(isEditableTarget(div)).toBe(true)
})

test('checkboxes, radios, buttons, and the page itself do not', () => {
  for (const type of ['checkbox', 'radio', 'button'])
    expect(isEditableTarget(input(type))).toBe(false)
  expect(isEditableTarget(document.createElement('button'))).toBe(false)
  expect(isEditableTarget(document.body)).toBe(false)
  expect(isEditableTarget(null)).toBe(false)
})

let tool = ''
function Harness() {
  useMarkupShortcuts()
  tool = useTool().tool
  return null
}

function press(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

beforeEach(() => setTool('select'))
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

test('a tool key switches the tool while no modal is open', () => {
  render(<Harness />)
  press(document.body, 's')
  expect(tool).toBe('stamp')
})

test('with a modal dialog open, keys pressed on its checkbox do not reach the markup behind it', () => {
  render(<Harness />)
  const dialog = document.createElement('dialog')
  const box = Object.assign(document.createElement('input'), { type: 'checkbox' })
  dialog.append(box)
  document.body.append(dialog)
  dialog.setAttribute('open', '')
  box.focus()
  expect(modalIsOpen()).toBe(true)
  for (const key of ['s', 'a', 'n', 'Escape']) press(box, key)
  expect(tool).toBe('select')
  dialog.removeAttribute('open')
  press(document.body, 'a')
  expect(tool).toBe('arrow')
})

test('the c shortcut places with the current mark', () => {
  render(<Harness />)
  act(() => {
    setTool('cue', 'warn')
    setCueMark('pointer')
  })
  press(document.body, 'c')
  expect(placeCue).toHaveBeenCalledWith(1, { x: 5, y: 6 }, 'warn', undefined, 'pointer')
  act(() => setCueMark('auto'))
})

test('the c shortcut in Auto places a line: there is no drag to make a highlight from', () => {
  render(<Harness />)
  act(() => {
    setTool('cue', 'go')
    setCueMark('auto')
  })
  press(document.body, 'c')
  expect(placeCue).toHaveBeenCalledWith(1, { x: 5, y: 6 }, 'go', undefined, 'line')
})
