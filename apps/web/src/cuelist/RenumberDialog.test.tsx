import { render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { RenumberDialog } from './RenumberDialog'

const placedRow = (i: number) => ({
  id: `c${i}`,
  major: 20 + i,
  minor: 0,
  anchor: JSON.stringify({ documentId: 'd1', pageIndex: 0, y: 700 - i }),
})
vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({}),
  useQuery: () => ({ data: [placedRow(0), placedRow(1), placedRow(2)] }),
}))

const preview = vi.hoisted(() => ({
  result: { changes: [] as unknown[], flagged: [] as unknown[] },
}))
vi.mock('./renumberLocally', async (original) => ({
  ...(await original<typeof import('./renumberLocally')>()),
  previewRenumber: () => preview.result,
}))

beforeEach(() => {
  // jsdom does not implement modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
})

const dialog = () =>
  render(
    <RenumberDialog
      departmentId="lx"
      departmentCode="LX"
      documents={[{ id: 'd1', title: 'Libretto' }]}
      editContext={() => null}
      onClose={() => {}}
    />,
  )

test('only spilled cues count as spilling into points; overflow cues are reported separately', () => {
  preview.result = {
    changes: [{ id: 'c0' }, { id: 'c1' }],
    flagged: [
      { id: 'c0', reason: 'spilled' },
      { id: 'c1', reason: 'overflow' },
      { id: 'c2', reason: 'overflow' },
    ],
  }
  const { getByRole } = dialog()
  const text = getByRole('status', { hidden: true }).textContent
  expect(text).toContain('2 of 3 cues will change')
  expect(text).toContain('1 will spill into points')
  expect(text).toContain("2 cues don't fit and keep their numbers")
})

test('with no overflow the overflow sentence is absent', () => {
  preview.result = { changes: [{ id: 'c0' }], flagged: [{ id: 'c0', reason: 'spilled' }] }
  const { getByRole } = dialog()
  const text = getByRole('status', { hidden: true }).textContent
  expect(text).toContain('1 will spill into points')
  expect(text).not.toContain("don't fit")
})
