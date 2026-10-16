import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { installDialogPolyfill, pressEscapeIn } from '../test/dialog'
import { useConfirm } from './useConfirm'

beforeEach(installDialogPolyfill)

let answer: boolean | null = null

function Page() {
  const { confirm, dialog } = useConfirm('Delete it?', 'Delete')
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          answer = await confirm('This cannot be undone.')
        }}
      >
        Ask
      </button>
      {dialog}
    </>
  )
}

async function ask() {
  answer = null
  render(<Page />)
  const opener = screen.getByRole('button', { name: 'Ask' })
  opener.focus()
  fireEvent.click(opener)
  await screen.findByText('This cannot be undone.')
  // The dialog took focus, as a modal does.
  expect(document.activeElement).not.toBe(opener)
  return opener
}

test('Cancel closes the dialog and returns focus to the control that opened it', async () => {
  const opener = await ask()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(answer).toBe(false))
  expect(screen.queryByText('This cannot be undone.')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

test('Escape declines and returns focus to the opener', async () => {
  const opener = await ask()
  pressEscapeIn(screen.getByRole('dialog', { name: 'Delete it?' }) as HTMLDialogElement)
  await waitFor(() => expect(answer).toBe(false))
  expect(document.activeElement).toBe(opener)
})

test('the confirm button answers yes and returns focus too', async () => {
  const opener = await ask()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(answer).toBe(true))
  expect(document.activeElement).toBe(opener)
})
