// Screenshot every mockup frame in a built page, one PNG per <section class="screen"> id.
//   node _shot.mjs /abs/path/to/page.html /abs/out/dir
// Imports Playwright from apps/web by absolute path so this can run from anywhere.
import { chromium } from '/Users/jayden/cueapp/apps/web/node_modules/@playwright/test/index.mjs'

const [html, out] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1340, height: 900 }, deviceScaleFactor: 1 })
await p.goto('file://' + html)
await p.waitForTimeout(800)
// $$eval is Playwright's DOM query helper (runs the arrow function against the matched elements in the page), not JS eval().
const ids = await p.$$eval('section.screen', (els) =>
  els.filter((e) => e.querySelector('.frame-wrap')).map((e) => e.id),
)
for (const id of ids) {
  const el = p.locator('#' + id + ' .frame-wrap')
  await el.scrollIntoViewIfNeeded()
  await p.waitForTimeout(150)
  await el.screenshot({ path: `${out}/${id}.png` })
}
await b.close()
console.log(ids.join(' '))
