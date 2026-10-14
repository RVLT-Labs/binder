import { FIXTURES } from '@binder/fixtures'
import { expect, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'
import { hasInk, uploadAndWaitReady } from './helpers'

test.use({ storageState: storageStateFor('a') })

/** The scan fixture has 8 pages and no text layer; processing runs OCR over it (about 15 s). */
const PAGES = 8

test('make available offline, go offline, reload, view and search', async ({ page, context }) => {
  test.setTimeout(300_000)
  const { sharedShow } = readRun()
  const title = `Offline scan ${Date.now()}`
  await uploadAndWaitReady(page, sharedShow.id, FIXTURES.scanPdf, title, 120_000)

  // Store the show's documents on this device.
  await page.getByRole('button', { name: 'Make available offline' }).click()
  await expect(page.getByText(/Available offline \(\d+ files\)/)).toBeVisible({ timeout: 120_000 })

  // The service worker has installed (precaching the shell and PDF.js) and controls the page.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  // Offline, and a cold reload: the app shell comes from the precache, the user from the device.
  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  await page.reload()
  const link = page.getByRole('list', { name: 'Documents' }).getByRole('link', { name: title })
  await expect(link).toBeVisible({ timeout: 30_000 })

  // The document opens and its first page renders, from cached bytes.
  await link.click()
  const toolbar = page.getByRole('toolbar', { name: 'Viewer' })
  await expect(toolbar).toContainText(`1 / ${PAGES}`, { timeout: 30_000 })
  const page1 = page.locator('[data-page-index="0"] canvas')
  await expect(page1).toBeVisible()
  await expect.poll(() => hasInk(page1), { timeout: 15_000 }).toBe(true)
  const thumb = page.getByRole('navigation', { name: 'Thumbnails' }).getByRole('img').first()
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0)

  // Search works from the cached word layers, and a hit highlights its page.
  await page.getByRole('searchbox', { name: 'Search document' }).fill('pirate')
  const hits = page.getByRole('list', { name: 'Search results' }).getByRole('listitem')
  await expect(hits.first()).toBeVisible({ timeout: 30_000 })
  const last = hits.last().getByRole('button')
  const pageNumber = Number(/Page (\d+)/.exec((await last.textContent()) ?? '')?.[1])
  await last.click()
  await expect(toolbar).toContainText(`${pageNumber} / ${PAGES}`)
  const sheet = page.locator(`[data-page-index="${pageNumber - 1}"]`)
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('svg rect.search-hit').first()).toBeVisible()
  await expect.poll(() => hasInk(sheet.locator('canvas')), { timeout: 15_000 }).toBe(true)
})
