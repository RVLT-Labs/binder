import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Command } from 'cmdk'
import { afterEach, expect, test, vi } from 'vitest'
import * as Palette from './CommandPalette'
import { isPaletteOpen, openPalette, registerDocumentHost, resetPaletteState } from './paletteState'

afterEach(resetPaletteState)

test('extra B09: actual palette result rows own a coarse 44px floor and 8px spacing while retaining 38px fine rows', () => {
  const source = readFileSync('src/palette/CommandPalette.tsx', 'utf8')
  const row = source.slice(source.indexOf('function ResultRow('), source.indexOf('function Part('))
  expect(row).toContain('[@media(pointer:coarse)]:min-h-11')
  expect(row).toContain('[@media(pointer:coarse)]:min-w-11')
  expect(row).toContain('[@media(pointer:coarse)]:h-auto')
  expect(row).toContain('[@media(pointer:coarse)]:mb-2')
  expect(row).toContain('h-[38px]')
  expect(row).toContain('onSelect={() => onRun(result)}')
})

test('extra B09: the existing presentational result row keeps cmdk option roles and keyboard activation', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  const run = vi.fn()
  const result = {
    id: 'fixture-result',
    label: 'Fixture page',
    icon: 'page' as const,
    parts: [{ text: 'Fixture page' }],
    run: vi.fn(),
  }
  render(
    <Command label="Fixture results">
      <Command.Input aria-label="Fixture query" />
      <Command.List>
        <Palette.ResultRow result={result} onRun={run} />
      </Command.List>
    </Command>,
  )
  const row = await screen.findByRole('option', { name: 'Fixture page' })
  fireEvent.click(row)
  expect(run).toHaveBeenCalledWith(result)
  run.mockClear()
  const input = screen.getByRole('combobox', { name: 'Fixture results' })
  input.focus()
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(run).toHaveBeenCalledWith(result))
})

test('extra B09: Calling still prevents opening and an unauthenticated shell does not mount the palette', () => {
  registerDocumentHost({
    documentId: 'fixture',
    versionId: 'fixture',
    pageCount: 1,
    calling: true,
    goToPage: vi.fn(),
    searchFor: vi.fn(),
    openPrint: vi.fn(),
    toggleCalling: vi.fn(),
  })
  openPalette()
  expect(isPaletteOpen()).toBe(false)
  const shell = readFileSync('src/shell/AppShell.tsx', 'utf8')
  expect(shell).toMatch(/showId\s*&&\s*<CommandPalette/)
  const root = readFileSync('src/routes/__root.tsx', 'utf8')
  expect(root).toContain('if (onLogin) return <Outlet />')
  expect(root).toContain('if (!user) return <Navigate to="/login" />')
  expect(root.indexOf('if (!user)')).toBeLessThan(root.indexOf('<PowerSyncProvider'))
})
