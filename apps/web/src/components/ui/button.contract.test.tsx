import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Button } from './button'

test('B07 loading retains the child-derived name and cannot override busy', () => {
  render(
    <Button loading aria-busy={false}>
      <svg aria-hidden />
      Save changes
    </Button>,
  )
  const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
})

test.each(['disabled', 'loading'] as const)(
  'B07 asChild %s suppresses child and parent pointer/keyboard handlers',
  (state) => {
    const child = vi.fn()
    const parent = vi.fn()
    render(
      <Button asChild {...{ [state]: true }} onClick={parent} onKeyDown={parent} aria-busy={false}>
        {/* biome-ignore lint/a11y/useValidAnchor: regression for the slotted link's handlers */}
        <a
          href="#activated"
          onClick={child}
          onKeyDown={child}
          onKeyUp={child}
          onPointerDown={child}
          aria-busy={false}
        >
          Download script
        </a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Download script' })
    fireEvent.pointerDown(link)
    fireEvent.click(link)
    fireEvent.keyDown(link, { key: 'Enter' })
    fireEvent.keyDown(link, { key: ' ' })
    fireEvent.keyUp(link, { key: ' ' })
    expect(child).not.toHaveBeenCalled()
    expect(parent).not.toHaveBeenCalled()
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(link.getAttribute('tabindex')).toBe('-1')
    if (state === 'loading') expect(link.getAttribute('aria-busy')).toBe('true')
  },
)
