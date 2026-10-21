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
    '--page-hit: #ffd21f',
    '--page-hit-active: #e8710a',
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

test("the mockups' type roles and button shadows are defined", () => {
  expect(tokens).toContain('@utility t-over')
  expect(tokens).toContain('@utility t-title')
  expect(tokens).toContain('@utility t-page-title')
  expect(tokens).toContain('--shadow-sticker: var(--sh-stk), var(--lit)')
  expect(tokens).toContain('--shadow-dialog: var(--sh-dialog)')
  expect(tokens).toContain('--sh-dialog: 0 6px 0 #0c0a08, 0 30px 60px rgba(0, 0, 0, 0.45)')
  expect(tokens).toContain('--scrim-strong: rgba(10, 8, 6, 0.76)')
})

test('the Paper theme is retoned so text passes 4.5:1 (rvlt-designlanguage v1.2.0)', () => {
  const light = tokens.slice(tokens.indexOf('.light {'))
  for (const decl of ['--ok: #007d36', '--warn: #9b5f00', '--muted: #665e4f', '--faint: #756b58']) {
    expect(light).toContain(decl)
  }
})

test('B02 white-on-red actions use canonical action-red while artwork keeps core red', async () => {
  const { buttonVariants } = await import('../components/ui/button')
  const { badgeVariants } = await import('../components/ui/badge')
  expect(tokens).toContain('--action-red: #d6323a')
  expect(tokens).toContain('--action-red: #c12229')
  expect(tokens).toContain('--color-action-red: var(--action-red)')
  for (const role of ['primary', 'destructive', 'sidebar-primary']) {
    expect(tokens).toContain(`--${role}: var(--action-red)`)
  }
  for (const variant of ['primary', 'halo'] as const) {
    expect(buttonVariants({ variant }).split(' ')).toContain('before:bg-primary')
  }
  expect(badgeVariants({ status: 'primary' }).split(' ')).toContain('bg-primary')
  const tool = readFileSync(join(import.meta.dirname, '../markup/ToolStrip.tsx'), 'utf8')
  expect(tool).toContain('aria-pressed:bg-primary')
  expect(tool).not.toContain('aria-pressed:bg-red ')
})

test('B04 controls have their own canonical 3:1 boundary role', () => {
  expect(tokens).toContain('--control-line: #857a69')
  expect(tokens).toContain('--control-line: var(--ink)')
  expect(tokens).toContain('--input: var(--control-line)')
  for (const file of ['checkbox', 'switch']) {
    const source = readFileSync(join(import.meta.dirname, `../components/ui/${file}.tsx`), 'utf8')
    expect(source).toContain('border-input')
    expect(source).not.toContain('border-border')
  }
  for (const file of ['markup/ToolStrip', 'viewer/ViewerToolbar', 'revisions/VersionSwitcher']) {
    expect(readFileSync(join(import.meta.dirname, `../${file}.tsx`), 'utf8')).toContain(
      'border-input',
    )
  }
})

test('B10 red words, errors and information pills use supported text roles', async () => {
  const { badgeVariants } = await import('../components/ui/badge')
  expect(tokens).toContain('--red-text: #ee5a5f')
  expect(tokens).toContain('--info: #82a8f3')
  expect(tokens).toContain('--info: #2a65d0')
  expect(tokens).toContain('--color-red-text: var(--red-text)')
  expect(tokens).toContain('--color-info: var(--info)')
  expect(badgeVariants({ status: 'info' })).toContain('text-info')
  expect(readFileSync(join(import.meta.dirname, '../shell/TabBar.tsx'), 'utf8')).toContain(
    'text-red-text',
  )
  expect(readFileSync(join(import.meta.dirname, '../auth/LoginForm.tsx'), 'utf8')).toContain(
    "message.failed ? 'text-t-out'",
  )
  expect(readFileSync(join(import.meta.dirname, '../panel/ContextPanel.tsx'), 'utf8')).toContain(
    'text-info',
  )
})
