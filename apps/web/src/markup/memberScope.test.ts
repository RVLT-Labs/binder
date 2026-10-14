import { expect, test } from 'vitest'
import { canUncheckDepartment, nextScope } from './memberScope'

test('checking a department adds it and keeps the others', () => {
  expect(nextScope(['lx'], 'snd', true)).toEqual(['lx', 'snd'])
  expect(nextScope(['lx', 'snd'], 'snd', true)).toEqual(['lx', 'snd'])
})

test('unchecking one of several departments removes only it', () => {
  expect(nextScope(['lx', 'snd'], 'lx', false)).toEqual(['snd'])
})

test('unchecking the last department sends nothing: it never widens the scope to all', () => {
  expect(nextScope(['lx'], 'lx', false)).toBeNull()
  expect(canUncheckDepartment(['lx'], 'lx')).toBe(false)
  expect(canUncheckDepartment(['lx', 'snd'], 'lx')).toBe(true)
})

test('the all-departments scope is changed only by the explicit All choice', () => {
  expect(nextScope(['*'], 'lx', true)).toEqual(['lx'])
  expect(nextScope(['*'], 'lx', false)).toBeNull()
})
