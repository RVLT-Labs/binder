import type { Actor } from '@binder/shared'
import { expect, test, vi } from 'vitest'
import { createDepartment, updateDepartment } from '../src/services/departments'
import type { Executor } from '../src/services/executor'

vi.mock('../src/services/tenancy', () => ({
  requireShowRole: vi.fn(),
  assertShowWritable: vi.fn(),
}))
vi.mock('../src/services/changeLog', () => ({ logChange: vi.fn() }))
const actor: Actor = { userId: 'disposable-unit-user', via: 'web', agent: null }
const current = {
  id: 'd',
  showId: 's',
  code: 'LX',
  name: 'Legacy',
  colour: '#FFFFFF',
  numberFormat: 'decimal',
  sortOrder: 0,
  hidden: false,
}
function database(update = false) {
  const answers: unknown[][] = update
    ? [[current], [{ id: 's' }]]
    : [[{ id: 's' }], [], [{ max: 0 }]]
  let fields: Record<string, unknown> = {}
  const tx = {
    transaction: async (fn: (value: unknown) => unknown) => fn(tx),
    select: () => ({ from: () => ({ where: async () => answers.shift() ?? [] }) }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => [{ ...current, ...value }],
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        fields = value
        return { where: () => ({ returning: async () => [{ ...current, ...fields }] }) }
      },
    }),
  }
  return tx as unknown as Executor
}

test.each(['#FFFFFF', '#FFFF00', '#E0363D'])(
  'B14 department service rejects new unsupported mark %s',
  async (colour) => {
    await expect(
      createDepartment(database(), actor, { showId: 's', code: 'NEW', name: 'New', colour }),
    ).rejects.toMatchObject({ code: 'invalid' })
  },
)

test('B14 legacy colour is preserved on unrelated edits including an unchanged echoed colour', async () => {
  const updated = await updateDepartment(database(true), actor, {
    departmentId: 'd',
    patch: { name: 'Renamed', colour: '#FFFFFF' },
  })
  expect(updated.colour).toBe('#FFFFFF')
  expect(updated.name).toBe('Renamed')
})

test('B14 deliberately changing a legacy value must satisfy the new mark policy', async () => {
  await expect(
    updateDepartment(database(true), actor, { departmentId: 'd', patch: { colour: '#FFFF00' } }),
  ).rejects.toMatchObject({ code: 'invalid' })
})
