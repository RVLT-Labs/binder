import { FIXTURES } from '@binder/fixtures'
import { expect, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'
import { hasInk, uploadAndWaitReady } from './helpers'

test.use({ storageState: storageStateFor('owner') })

/** The scan fixture has 8 pages and no text layer; processing runs OCR over it (about 15 s). */
const PAGES = 8

test('make available offline, go offline, reload, view and search', async ({ page, context }) => {
  test.setTimeout(300_000)
  const { sharedShow } = readRun()
  const title = `Offline scan ${Date.now()}`
  await uploadAndWaitReady(page, sharedShow.id, FIXTURES.scanPdf, title, 120_000)

  // Store the show's documents on this device (the button is in the show page's top bar).
  await page.goto(`/shows/${sharedShow.id}`)
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
  // Presence is silently absent offline: the reloaded app opens no socket.
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  await page.reload()
  const link = page.getByRole('list', { name: 'Documents' }).getByRole('link', { name: title })
  await expect(link).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'In the binder now' })).toHaveCount(0)

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
  await page.getByRole('button', { name: 'Find in document' }).click()
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

  // Calling mode works from the same cache: the page, the strip and the keypad, offline, and the
  // status line says so as a calm state rather than an error.
  await page.getByRole('button', { name: 'Calling mode' }).click()
  const strip = page.getByRole('region', { name: 'Calling', exact: true })
  await expect(strip).toContainText(`p.${pageNumber} / ${PAGES}`)
  await expect(page.getByRole('region', { name: 'Calling status' })).toContainText(
    'offline, cached',
  )
  await expect(toolbar).toHaveCount(0)
  await expect.poll(() => hasInk(sheet.locator('canvas')), { timeout: 15_000 }).toBe(true)
  await page.keyboard.press('g')
  const keypad = page.getByRole('dialog', { name: 'Go to' })
  await keypad.getByRole('radio', { name: 'Page' }).click()
  await keypad.getByRole('button', { name: '1', exact: true }).click()
  await keypad.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(strip).toContainText(`p.1 / ${PAGES}`)
  const first = page.locator('[data-page-index="0"] canvas')
  await expect.poll(() => hasInk(first), { timeout: 15_000 }).toBe(true)
  await page.getByRole('button', { name: 'Exit' }).click()
  await expect(toolbar).toContainText(`1 / ${PAGES}`)

  // Still no presence socket, no presence UI, and no error shown for its absence.
  expect(sockets).toEqual([])
  await expect(page.getByRole('group', { name: /People on page/ })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
