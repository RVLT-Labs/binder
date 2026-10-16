import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

// biome's CSS formatter lower-cases hex digits; the values are compared case-insensitively.
const tokens = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8').toLowerCase()

test('tokens.css defines the RVLT espresso chrome and the Binder page tokens', () => {
  for (const decl of [
    '--paper: #141210',
    '--card: #211c17',
    '--ink: #f5efe2',
    '--red: #e0363d',
    '--page: #ffffff',
    '--page-ink: #1a1715',
    '--stage: #0e0c0a',
  ]) {
    expect(tokens).toContain(decl)
  }
})

test('the @theme inline block maps the tokens to Tailwind utilities', () => {
  const theme = tokens.slice(tokens.indexOf('@theme inline'))
  for (const mapping of [
    '--color-paper:',
    '--color-page:',
    '--color-page-ink:',
    '--color-stage:',
    '--font-mono:',
    '--shadow-card:',
  ]) {
    expect(theme).toContain(mapping)
  }
})

test('Flow component class names resolve unchanged: font-display and the cream variant', () => {
  const theme = tokens.slice(tokens.indexOf('@theme inline'))
  expect(theme).toContain('--font-display:')
  expect(theme).not.toContain('--font-disp:')
  expect(theme).toContain('--color-cream: var(--cream)')
  expect(theme).toContain('--color-cream-ink: var(--cream-ink)')
  expect(tokens).toContain('--sh-cream:')
  expect(tokens).toContain('--sh-cream-press:')
})
