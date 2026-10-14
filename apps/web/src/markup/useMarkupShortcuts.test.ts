import { expect, test } from 'vitest'
import { isEditableTarget } from './useMarkupShortcuts'

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
