import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { LoginCard } from './LoginCard'

vi.mock('./client', () => ({ authClient: { signIn: { email: vi.fn(), magicLink: vi.fn() } } }))

test('B09 optional magic-link action retains a real 44px target at tablet widths', () => {
  render(<LoginCard magicLink onSignedIn={async () => {}} />)
  const link = screen.getByRole('button', { name: 'Email me a link instead' })
  expect(getComputedStyle(link).minHeight).toBe('44px')
  expect(getComputedStyle(link).minWidth).toBe('44px')
})

test('names the page for assistive tech as Sign in to Binder, and draws the wordmark', () => {
  render(<LoginCard magicLink={false} onSignedIn={async () => {}} />)
  const heading = screen.getByRole('heading', { level: 1, name: 'Sign in to Binder' })
  expect(heading.textContent).toContain('Binder')
  expect(screen.getByText('by RVLT')).toBeTruthy()
})

test('has the Kalam line, the labelled fields and the offline note', () => {
  render(<LoginCard magicLink={false} onSignedIn={async () => {}} />)
  const line = screen.getByText('the book is where you left it')
  expect(line.className).toContain('font-hand')
  expect(line.className).toContain('text-muted')
  expect(screen.getByLabelText('Email')).toBeTruthy()
  expect(screen.getByLabelText('Password')).toBeTruthy()
  expect(screen.getByText(/opens offline/)).toBeTruthy()
})

test('Sign in is the full-width primary and waits for a password', () => {
  render(<LoginCard magicLink onSignedIn={async () => {}} />)
  const button = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.className).toContain('w-full')
  expect(button.className).toContain('before:bg-primary')
  expect(screen.getByRole('button', { name: 'Email me a link instead' })).toBeTruthy()
})
