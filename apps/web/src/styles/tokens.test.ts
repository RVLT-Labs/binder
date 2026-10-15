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
    '--font-mono:',
    '--font-disp:',
    '--shadow-card:',
  ]) {
    expect(theme).toContain(mapping)
  }
})
