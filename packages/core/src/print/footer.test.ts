import { expect, test } from 'vitest'
import { footerText, layerSelectionLabel } from './footer'

const base = {
  showTitle: 'Pirates',
  documentLabel: 'Libretto v2',
  layerLabel: 'LX, SND',
  binderVersion: null,
  exportId: '0190f3a2-0000-7000-8000-00000000abcd',
  date: new Date(2026, 9, 15, 14, 2),
}

test('footer text', () =>
  expect(footerText(base)).toBe(
    'Pirates · Libretto v2 · LX, SND · export 0000abcd · 2026-10-15 14:02',
  ))

test('a saved Binder version replaces the export id', () =>
  expect(footerText({ ...base, binderVersion: 7 })).toBe(
    'Pirates · Libretto v2 · LX, SND · Binder v7 · 2026-10-15 14:02',
  ))

test('the date is local time, zero padded', () =>
  expect(footerText({ ...base, date: new Date(2026, 0, 5, 3, 4) })).toContain('2026-01-05 03:04'))

const depts = [
  { id: 'd-lx', code: 'LX' },
  { id: 'd-snd', code: 'SND' },
  { id: 'd-tm', code: 'TM' },
]
const dept = (id: string) => ({ kind: 'department' as const, id })
const personal = { kind: 'personal' as const, id: 'u-1' }

test('layer labels: none is Clean copy, every department is All layers', () => {
  expect(layerSelectionLabel([], depts)).toBe('Clean copy')
  expect(
    layerSelectionLabel(
      depts.map((d) => dept(d.id)),
      depts,
    ),
  ).toBe('All layers')
})

test('layer labels: codes in department order, then the personal layer', () => {
  // Selection order does not matter: the department order does.
  expect(layerSelectionLabel([dept('d-tm'), dept('d-lx')], depts)).toBe('LX, TM')
  expect(layerSelectionLabel([dept('d-snd'), personal], depts)).toBe('SND + personal')
  expect(layerSelectionLabel([personal], depts)).toBe('Personal')
  expect(layerSelectionLabel([dept('d-lx'), dept('d-lx')], depts)).toBe('LX')
})

test('a selected layer of a department that no longer exists is not named', () =>
  expect(layerSelectionLabel([dept('d-gone'), dept('d-lx')], depts)).toBe('LX'))
