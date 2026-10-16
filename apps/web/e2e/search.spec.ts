import { FIXTURES } from '@binder/fixtures'
import { expect, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'
import { uploadAndWaitReady } from './helpers'

test.use({ storageState: storageStateFor('owner') })

/** The scan fixture has 8 pages and no text layer; processing runs OCR over it (about 15 s). */
const PAGES = 8
const READY_TIMEOUT = 120_000

test('search lists hits, Enter steps through them, and a hit scrolls to its page and highlights it', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const { sharedShow } = readRun()
  const title = `Scan search ${Date.now()}`
  const row = await uploadAndWaitReady(page, sharedShow.id, FIXTURES.scanPdf, title, READY_TIMEOUT)
  await row.getByRole('link', { name: title }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Viewer' })
  await expect(toolbar).toContainText(`1 / ${PAGES}`, { timeout: 30_000 })

  // Find is the strip's tool (and the `/` key): it opens the search card with the cursor in its box.
  await page.getByRole('button', { name: 'Find in document' }).click()
  // Typing searches; results show page numbers and snippets.
  const box = page.getByRole('searchbox', { name: 'Search document' })
  await box.fill('pirate')
  const results = page.getByRole('list', { name: 'Search results' })
  const hits = results.getByRole('listitem')
  await expect(hits.first()).toBeVisible({ timeout: 30_000 })
  const count = await hits.count()
  expect(count).toBeGreaterThan(1)
  await expect(hits.first()).toContainText(/Page \d+/)
  await expect(hits.first()).toContainText(/pirate/i)
  await expect(page.getByRole('status').filter({ hasText: /results?$/ })).toContainText(
    `${count} results`,
  )

  // Enter goes to the next hit: the first, then the second.
  await box.press('Enter')
  await expect(hits.nth(0).getByRole('button')).toHaveAttribute('aria-current', 'true')
  await box.press('Enter')
  await expect(hits.nth(1).getByRole('button')).toHaveAttribute('aria-current', 'true')
  await expect(hits.nth(0).getByRole('button')).not.toHaveAttribute('aria-current', 'true')

  // Clicking the last hit scrolls to its page and draws a highlight over the matched word.
  const last = hits.last().getByRole('button')
  const pageNumber = Number(/Page (\d+)/.exec((await last.textContent()) ?? '')?.[1])
  expect(pageNumber).toBeGreaterThan(1)
  await last.click()
  await expect(toolbar).toContainText(`${pageNumber} / ${PAGES}`)
  const sheet = page.locator(`[data-page-index="${pageNumber - 1}"]`)
  await expect(sheet).toBeVisible()
  const rect = sheet.locator('svg rect.search-hit-active')
  await expect(rect.first()).toBeVisible()
  // The overlay never takes the pointer, and the rect lies on the page.
  await expect(sheet.locator('svg')).toHaveCSS('pointer-events', 'none')
  const [box_, sheetBox] = await Promise.all([rect.first().boundingBox(), sheet.boundingBox()])
  expect(box_?.width).toBeGreaterThan(0)
  expect(box_?.height).toBeGreaterThan(0)
  expect(box_?.x).toBeGreaterThanOrEqual((sheetBox?.x ?? 0) - 1)
  expect(box_?.y).toBeGreaterThanOrEqual((sheetBox?.y ?? 0) - 1)
  expect((box_?.x ?? 0) + (box_?.width ?? 0)).toBeLessThanOrEqual(
    (sheetBox?.x ?? 0) + (sheetBox?.width ?? 0) + 1,
  )

  // A query with no matches says so, and clears the highlights.
  await box.fill('zzzzqqqq')
  await expect(page.getByRole('status').filter({ hasText: 'No results' })).toBeVisible()
  await expect(page.locator('svg rect.search-hit')).toHaveCount(0)

  // Escape in the box shuts the card, takes the highlights off the pages and keeps the document.
  await box.fill('pirate')
  await expect(hits.first()).toBeVisible()
  await box.press('Escape')
  await expect(box).toHaveCount(0)
  await expect(page.locator('svg rect.search-hit')).toHaveCount(0)
  // and the `/` key brings it back
  await page.getByRole('region', { name: 'Pages' }).focus()
  await page.keyboard.press('/')
  await expect(box).toBeFocused()
})
