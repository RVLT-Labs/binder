import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { APPLE_TOUCH_ICON, webManifest } from './manifest'

const WEB = join(import.meta.dirname, '..')
const tokens = readFileSync(join(WEB, 'src', 'styles', 'tokens.css'), 'utf8')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const bytes = readFileSync(join(WEB, 'public', file))
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('the manifest makes Binder installable as a standalone app', () => {
  expect(webManifest).toMatchObject({
    name: 'Binder',
    short_name: 'Binder',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  })
})

test('theme and background colours are the espresso paper from tokens.css', () => {
  expect(webManifest.background_color).toBe('#141210')
  expect(webManifest.theme_color).toBe('#141210')
  expect(tokens).toContain(`--paper: ${webManifest.background_color};`)
  expect(tokens).toContain(`--paper: ${webManifest.theme_color};`)
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  expect(html).toContain('<meta name="theme-color" content="#141210" />')
})

test('every icon exists at its declared size, including 192 and 512', () => {
  const sizes = webManifest.icons.map((icon) => icon.sizes)
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
  for (const icon of webManifest.icons) {
    expect(icon.type).toBe('image/png')
    const [w, h] = pngSize(icon.src.replace(/^\//, ''))
    expect(`${w}x${h}`).toBe(icon.sizes)
  }
})

test('index.html links the apple-touch-icon, which is 180 px', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  expect(html).toContain(`<link rel="apple-touch-icon" href="${APPLE_TOUCH_ICON}" />`)
  expect(pngSize(APPLE_TOUCH_ICON.replace(/^\//, ''))).toEqual([180, 180])
})
