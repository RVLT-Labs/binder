import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { TopBarSlotsContext } from '../shell/TopBarSlots'
import { DocumentControls } from './DocumentControls'

test('extra B09: document menu rows inherit the coarse floor and retain deferred Go to page focus', async () => {
  const focusDestination = document.createElement('input')
  document.body.append(focusDestination)
  const go = vi.fn(() => focusDestination.focus())
  const renumber = vi.fn()
  const upload = vi.fn()
  render(
    <TopBarSlotsContext.Provider value={{ chip: null, actions: document.body, phone: null }}>
      <DocumentControls
        version={() => null}
        panel={null}
        onUploadRevision={upload}
        thumbnails={{ open: false, onToggle: vi.fn() }}
        print={null}
        onPrint={null}
        onCalling={null}
        onGoToPage={go}
        onRenumber={renumber}
      />
    </TopBarSlotsContext.Provider>,
  )
  const trigger = screen.getByRole('button', { name: 'Document options' })
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const rows = await screen.findAllByRole('menuitem')
  expect(rows).toHaveLength(4)
  for (const row of rows) {
    expect(row.className).toContain('[@media(pointer:fine)]:min-h-8')
    expect(row.className).toContain('[@media(pointer:coarse)]:min-h-11')
  }
  const destination = screen.getByRole('menuitem', { name: /Go to page/ })
  destination.focus()
  fireEvent.keyDown(destination, { key: 'Enter' })
  await waitFor(() => expect(document.activeElement).toBe(focusDestination))
  expect(go).toHaveBeenCalledTimes(1)
  expect(upload).not.toHaveBeenCalled()
  expect(renumber).not.toHaveBeenCalled()
  focusDestination.remove()
})
