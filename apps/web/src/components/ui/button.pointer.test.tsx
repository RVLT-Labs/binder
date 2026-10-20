import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Button } from './button'

test('B07 disabled slotted links also suppress auxiliary pointer and touch handlers', () => {
  const activate = vi.fn()
  render(
    <Button asChild disabled>
      <a href="/synthetic.pdf" onAuxClick={activate} onTouchStart={activate} onTouchEnd={activate}>
        Synthetic download
      </a>
    </Button>,
  )
  const link = screen.getByRole('link')
  fireEvent(link, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
  fireEvent.touchStart(link)
  fireEvent.touchEnd(link)
  expect(activate).not.toHaveBeenCalled()
})
