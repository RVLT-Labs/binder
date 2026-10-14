import { describe, expect, test } from 'vitest'
import {
  annotationToolState,
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
    hidden: [] as string[],
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

  test('a hidden target layer disables it: a cue placed there would be invisible', () => {
    expect(cueToolState({ ...base, hidden: ['department:lx'] })).toEqual({
      disabled: 'Show the LX layer to place cues on it',
    })
    expect(
      cueToolState({ ...base, active: me, lastActiveDepartment: 'lx', hidden: ['department:lx'] }),
    ).toEqual({ disabled: 'Show the LX layer to place cues on it' })
    // Hiding some other layer changes nothing.
    expect(cueToolState({ ...base, hidden: ['department:snd'] })).toEqual({ departmentId: 'lx' })
  })

  test('a locked target layer disables it and says which', () => {
    expect(cueToolState({ ...base, locked: ['department:lx'] })).toEqual({
      disabled: 'The LX layer is locked.',
    })
  })
})

describe('annotationToolState', () => {
  const lx = { kind: 'department' as const, id: 'lx' }
  const me = { kind: 'personal' as const, id: 'u1' }
  const base = {
    readOnly: null,
    active: lx as typeof lx | typeof me | null,
    editable: [lx, me],
    locked: [] as string[],
    hidden: [] as string[],
    layerName: (l: { kind: string; id: string }) => (l.kind === 'personal' ? 'Personal' : 'LX'),
  }

  test('draws on the active layer, department or personal', () => {
    expect(annotationToolState(base)).toEqual({ layer: lx })
    expect(annotationToolState({ ...base, active: me })).toEqual({ layer: me })
  })

  test('an archived show disables it with the read-only reason', () => {
    expect(annotationToolState({ ...base, readOnly: 'archived!' })).toEqual({
      disabled: 'archived!',
    })
  })

  test('it waits for the membership to sync', () => {
    expect(annotationToolState({ ...base, active: null, editable: [] })).toEqual({
      disabled: LOADING_LAYERS_HINT,
    })
  })

  test('a hidden active layer disables it: a shape drawn there would be invisible', () => {
    expect(annotationToolState({ ...base, hidden: ['department:lx'] })).toEqual({
      disabled: 'Show the LX layer to draw on it',
    })
    expect(annotationToolState({ ...base, active: me, hidden: ['personal:u1'] })).toEqual({
      disabled: 'Show the Personal layer to draw on it',
    })
    expect(annotationToolState({ ...base, hidden: ['department:snd'] })).toEqual({ layer: lx })
  })

  test('a locked active layer disables it and says which', () => {
    expect(annotationToolState({ ...base, locked: ['department:lx'] })).toEqual({
      disabled: 'The LX layer is locked.',
    })
    expect(annotationToolState({ ...base, active: me, locked: ['personal:u1'] })).toEqual({
      disabled: 'The Personal layer is locked.',
    })
  })

  test('a layer the user cannot edit is never a target', () => {
    expect(annotationToolState({ ...base, editable: [me] })).toEqual({
      disabled: "You can't edit the LX layer.",
    })
  })
})
