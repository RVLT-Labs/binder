import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { BinderMark } from './BinderMark'

test('the mark is decorative unless it is given a name', () => {
  const { container } = render(<BinderMark />)
  const svg = container.querySelector('svg') as SVGSVGElement
  expect(svg.getAttribute('aria-hidden')).toBe('true')
  expect(svg.getAttribute('role')).toBeNull()
})

test('with a title the mark is an image with that accessible name', () => {
  const { getByRole } = render(<BinderMark title="Binder" />)
  const svg = getByRole('img', { name: 'Binder' })
  expect(svg.querySelector('title')?.textContent).toBe('Binder')
})
