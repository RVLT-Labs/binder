import { describe, expect, test } from 'vitest'
import {
  cueTargetDepartment,
  cueToolState,
  LOADING_LAYERS_HINT,
  NO_DEPARTMENT_HINT,
} from './activeDepartment'

const dept = (id: string) => ({ kind: 'department' as const, id })
const me = { kind: 'personal' as const, id: 'u1' }

test('an active department layer is the target', () => {
  expect(cueTargetDepartment(dept('snd'), 'lx', [dept('lx'), dept('snd'), me])).toEqual({
    departmentId: 'snd',
  })
})

test('with the personal layer active the last active editable department is the target', () => {
  expect(cueTargetDepartment(me, 'snd', [dept('lx'), dept('snd'), me])).toEqual({
    departmentId: 'snd',
  })
})

test('with no usable last department the first editable department is the target', () => {
  const editable = [dept('lx'), dept('snd'), me]
  expect(cueTargetDepartment(me, null, editable)).toEqual({ departmentId: 'lx' })
  expect(cueTargetDepartment(me, 'tm', editable)).toEqual({ departmentId: 'lx' })
})

test('with no editable department the tool is disabled with the hint', () => {
  expect(cueTargetDepartment(me, 'lx', [me])).toEqual({
    disabled: "Cues go on a department layer, and you can't edit any in this show.",
  })
})

describe('cueToolState', () => {
  const lx = { kind: 'department' as const, id: 'lx' }
  const me = { kind: 'personal' as const, id: 'u1' }
  const base = {
    readOnly: null,
    active: lx,
    lastActiveDepartment: null,
    editable: [lx, me],
    locked: [] as string[],
    departmentCode: (id: string) => id.toUpperCase(),
  }

  test('places into the target department', () => {
    expect(cueToolState(base)).toEqual({ departmentId: 'lx' })
    expect(cueToolState({ ...base, active: me, lastActiveDepartment: 'lx' })).toEqual({
      departmentId: 'lx',
    })
  })

  test('an archived show disables it with the read-only reason', () => {
    expect(cueToolState({ ...base, readOnly: 'archived!' })).toEqual({ disabled: 'archived!' })
  })

  test('it waits for the membership to sync', () => {
    expect(cueToolState({ ...base, active: null, editable: [] })).toEqual({
      disabled: LOADING_LAYERS_HINT,
    })
  })

  test('with no editable department it is disabled with the hint', () => {
    expect(cueToolState({ ...base, active: me, editable: [me] })).toEqual({
      disabled: NO_DEPARTMENT_HINT,
    })
  })

  test('a locked target layer disables it and says which', () => {
    expect(cueToolState({ ...base, locked: ['department:lx'] })).toEqual({
      disabled: 'The LX layer is locked.',
    })
  })
})
