import type { WordLayer } from '@binder/shared'
import { type Browser, type BrowserContext, expect, type Page } from '@playwright/test'
import { readRun, storageStateFor, type UserKey } from './env'

/** Shared by the markup specs: two or more users open the same libretto page in separate browsers. */

export interface Opened {
  context: BrowserContext
  page: Page
}

/** Opens the libretto as `user` and waits until its layers (and so its membership) have synced. */
export async function openLibretto(browser: Browser, user: UserKey, contexts: BrowserContext[]) {
  const { sharedShow, libretto } = readRun()
  const context = await browser.newContext({ storageState: storageStateFor(user) })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(`/shows/${sharedShow.id}/docs/${libretto.documentId}`)
  await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('1 / 3', {
    timeout: 30_000,
  })
  await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible()
  return { context, page }
}

export async function withUsers(
  browser: Browser,
  users: UserKey[],
  body: (opened: Opened[]) => Promise<void>,
): Promise<void> {
  const contexts: BrowserContext[] = []
  try {
    const opened: Opened[] = []
    for (const user of users) opened.push(await openLibretto(browser, user, contexts))
    await body(opened)
  } finally {
    for (const context of contexts) await context.close()
  }
}

/** The page's word layer and displayed size, read the way the app reads them. */
export async function pageText(page: Page, pageIndex: number) {
  const { libretto } = readRun()
  return page.evaluate(
    async ({ versionId, pageIndex }) => {
      const rows =
        (await window.__binder?.db.getAll<{ words_key: string; width: number; height: number }>(
          'SELECT words_key, width, height FROM pages WHERE document_version_id = ? AND "index" = ?',
          [versionId, pageIndex],
        )) ?? []
      const row = rows[0]
      if (!row) throw new Error(`page ${pageIndex} not synced`)
      const url = `/blobs/${row.words_key.split('/').map(encodeURIComponent).join('/')}`
      const words = (await (await fetch(url)).json()) as WordLayer
      return { words, width: row.width, height: row.height }
    },
    { versionId: libretto.versionId, pageIndex },
  )
}

export interface Line {
  /** Mean of the words' vertical centres: where a snapped cue sits. */
  centre: number
  /** Just inside the line's first word. */
  x: number
  /** The first eight words: the quote a cue placed at `x` captures. */
  quote: string
}

/** The `n`th line (zero-based) with at least three words. */
export function lineOf(layer: WordLayer, n: number): Line {
  const lines = layer.lines.filter((l) => l.length >= 3)
  const line = lines[n]
  if (!line) throw new Error(`no line ${n}`)
  const words = line.map((i) => layer.words[i])
  const centre = words.reduce((sum, w) => sum + w.y + w.h / 2, 0) / words.length
  return {
    centre,
    x: words[0].x + 2,
    quote: words
      .slice(0, 8)
      .map((w) => w.t)
      .join(' '),
  }
}

/** Viewport coordinates of a displayed-space point on a page. */
export async function clientPoint(page: Page, pageIndex: number, x: number, y: number) {
  const { width, height } = await pageText(page, pageIndex)
  const sheet = page.locator(`[data-page-index="${pageIndex}"]`)
  const box = await sheet.boundingBox()
  if (!box) throw new Error(`page ${pageIndex} not on screen`)
  const zoom = box.width / width
  return { x: box.x + x * zoom, y: box.y + (height - y) * zoom }
}

export async function clickAt(page: Page, pageIndex: number, x: number, y: number) {
  const p = await clientPoint(page, pageIndex, x, y)
  await page.mouse.click(p.x, p.y)
}
