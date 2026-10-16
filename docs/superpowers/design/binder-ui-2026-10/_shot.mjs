// Screenshot every mockup frame in a built page, one PNG per <section class="screen"> id.
//   node _shot.mjs /abs/path/to/page.html /abs/out/dir
// Imports Playwright from this checkout's apps/web (run `pnpm install` first), so it works from any
// working directory and from any worktree.
const { chromium } = await import(
  new URL('../../../../apps/web/node_modules/@playwright/test/index.mjs', import.meta.url).href
)

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
