import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { installDialogPolyfill, pressEscapeIn } from '../test/dialog'

// The server's "this has changed since" is simulated: `mutate` asks the question it was given.
let answer: boolean | null = null
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  useRevert: (_showId: string, confirm: (q: string) => Promise<boolean>) => ({
    mutate: async () => {
      answer = await confirm('This has changed since. Revert anyway?')
    },
    isPending: false,
  }),
}))
const { useRevertAction } = await import('./useRevertAction')

beforeEach(() => {
  installDialogPolyfill()
  answer = null
})

function Page({ onKey }: { onKey: (e: KeyboardEvent) => void }) {
  const { revert, dialog } = useRevertAction('show-1')
  document.onkeydown = onKey
  return (
    <>
      <button type="button" onClick={() => revert({ seq: 1 })}>
        Revert
      </button>
      {dialog}
    </>
  )
}

async function ask(onKey: (e: KeyboardEvent) => void = () => {}) {
  render(<Page onKey={onKey} />)
  const opener = screen.getByRole('button', { name: 'Revert' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', {
    name: 'This has changed since. Revert anyway?',
  })
  return { opener, dialog: dialog as HTMLDialogElement }
}

test('the question is a DialogShell dialog with Cancel and Revert anyway', async () => {
  const { dialog } = await ask()
  expect(dialog.className).toContain('rounded-[20px]')
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Revert anyway' })).toBeTruthy()
})

test('Escape is no, and focus goes back to the Revert that asked', async () => {
  const { opener, dialog } = await ask()
  pressEscapeIn(dialog)
  await waitFor(() => expect(answer).toBe(false))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

test('Cancel is no; Revert anyway is yes', async () => {
  const first = await ask()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(answer).toBe(false))
  expect(document.activeElement).toBe(first.opener)
})

test('Revert anyway answers yes', async () => {
  const { opener } = await ask()
  fireEvent.click(screen.getByRole('button', { name: 'Revert anyway' }))
  await waitFor(() => expect(answer).toBe(true))
  expect(document.activeElement).toBe(opener)
})

test("keys typed in the dialog do not reach the document's markup shortcuts", async () => {
  const seen = vi.fn()
  const { dialog } = await ask(seen)
  fireEvent.keyDown(dialog, { key: 'Delete' })
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: '3' })
  expect(seen).not.toHaveBeenCalled()
})
