import { expect, test } from 'vitest'
import { cueTargetDepartment } from './activeDepartment'

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
