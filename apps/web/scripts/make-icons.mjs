// Draws the Binder mark and writes every icon the app ships: the SVG favicon, the manifest PNGs
// (rounded for "any", full-bleed for "maskable"), the iOS home-screen icon and a 32 px PNG favicon.
//
//   pnpm icons        (from apps/web; uses the Playwright Chromium the e2e suite already installs)
//
// The mark is a monoline B whose two bowls are the D-rings of a binder hung on the spine, drawn
// with the same construction as the RVLT wordmark's letters (round caps, stem 0.16 of cap height).
// The letter spans 106–406 of the 512 tile, inside the 80 % circle a maskable crop keeps.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const RED = '#E0363D'
const INK = '#F5EFE2'
const LETTER =
  `<g fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">` +
  '<path d="M170 131V381" stroke-width="50"/>' +
  '<path d="M170 131H262A60 60 0 0 1 262 251H170M170 251H282A65 65 0 0 1 282 381H170" stroke-width="44"/>' +
  '</g>'

/** The tile at a corner radius (116 is the app-icon squircle; 0 is full bleed for crops the OS makes). */
const tile = (rx) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="${RED}"/>${LETTER}</svg>`

/** file, pixel size, corner radius in the 512 space */
const PNGS = [
  ['icon-192.png', 192, 116],
  ['icon-512.png', 512, 116],
  ['icon-512-maskable.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  ['favicon-32.png', 32, 116],
]

writeFileSync(
  join(PUBLIC, 'favicon.svg'),
  `${tile(116).replace('viewBox="0 0 512 512">', 'viewBox="0 0 512 512" role="img" aria-label="Binder"><title>Binder</title>')}\n`,
)

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const [file, size, rx] of PNGS) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${tile(rx).replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`,
  )
  const png = await page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  })
  writeFileSync(join(PUBLIC, file), png)
  console.log(`${file} ${size}×${size}`)
}
await browser.close()
