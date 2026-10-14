import { FIXTURES } from '@binder/fixtures'
import { expect, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'
import { hasInk, uploadAndWaitReady } from './helpers'

test.use({ storageState: storageStateFor('a') })

/** The libretto fixture (generated from fixtures/public/pirates.txt) has 147 pages. */
const PAGES = 147
/**
 * Text PDFs skip OCR, but each of the 147 pages still gets its own job (words and a thumbnail):
 * about 2.5 minutes on a laptop, so this allows 4.
 */
const READY_TIMEOUT = 240_000

test('upload, process, and view the libretto', async ({ page }) => {
  test.setTimeout(360_000)
  const { sharedShow } = readRun()
  const title = `Libretto ${Date.now()}`

  // Upload as the owner and wait for processing.
  const row = await uploadAndWaitReady(
    page,
    sharedShow.id,
    FIXTURES.librettoPdf,
    title,
    READY_TIMEOUT,
  )

  // Open the viewer.
  await row.getByRole('link', { name: title }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Viewer' })
  await expect(toolbar).toContainText(`1 / ${PAGES}`, { timeout: 30_000 })
  await expect(page.getByLabel('Version')).toContainText('v1 · ready')

  // Thumbnails: the rail lists every page, and the first one loads.
  const rail = page.getByRole('navigation', { name: 'Thumbnails' })
  await expect(rail.getByRole('button')).toHaveCount(PAGES)
  const thumb1 = rail.getByRole('img', { name: 'Page 1', exact: true })
  await expect(thumb1).toBeVisible()
  await expect
    .poll(() => thumb1.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0)

  // Jump to page 3 with the page input.
  await toolbar.getByLabel('Go to page').fill('3')
  await toolbar.getByLabel('Go to page').press('Enter')
  await expect(toolbar).toContainText(`3 / ${PAGES}`)
  await expect(page).toHaveURL(/[?&]p=3(&|$)/)
  const page3 = page.locator('[data-page-index="2"] canvas')
  await expect(page3).toBeVisible()
  await expect.poll(() => hasInk(page3), { timeout: 15_000 }).toBe(true)
  await expect(rail.getByRole('button', { name: 'Page 3', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // Keyboard: the page list has focus; PageDown moves one page, + zooms in.
  const pages = page.getByRole('region', { name: 'Pages' })
  await pages.focus()
  await page.keyboard.press('PageDown')
  await expect(toolbar).toContainText(`4 / ${PAGES}`)
  const zoomBefore = await toolbar.getByLabel('Zoom level').textContent()
  await page.keyboard.press('+')
  await expect(toolbar.getByLabel('Zoom level')).not.toHaveText(zoomBefore ?? '')
  await expect(toolbar).toContainText(`4 / ${PAGES}`)

  // Scroll through the whole document: virtualisation keeps only a handful of canvases alive.
  let most = 0
  for (;;) {
    const { count, atEnd } = await pages.evaluate((el) => {
      el.scrollTop += el.clientHeight * 2
      return {
        count: document.querySelectorAll('canvas').length,
        atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
      }
    })
    most = Math.max(most, count)
    await page.waitForTimeout(40)
    if (atEnd) break
  }
  await expect(toolbar).toContainText(`${PAGES} / ${PAGES}`)
  const last = page.locator(`[data-page-index="${PAGES - 1}"] canvas`)
  await expect.poll(() => hasInk(last), { timeout: 15_000 }).toBe(true)
  most = Math.max(most, await page.locator('canvas').count())
  expect(most).toBeLessThanOrEqual(6)

  // A deep link opens at its page.
  await page.goto(`${page.url().split('?')[0]}?p=10`)
  await expect(toolbar).toContainText(`10 / ${PAGES}`, { timeout: 30_000 })
  await expect.poll(() => hasInk(page.locator('[data-page-index="9"] canvas'))).toBe(true)
})
