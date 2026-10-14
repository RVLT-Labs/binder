import type { Anchor, WordLayer } from '@binder/shared'
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { NO_DEPARTMENT_HINT } from '../src/markup/activeDepartment'
import { readRun, storageStateFor, type UserKey } from './env'

/**
 * Cue markup on the short libretto (three text pages) that global setup uploaded. Every write goes
 * through the viewer's tools into the local PowerSync database and syncs to a second user's device.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

interface Opened {
  context: BrowserContext
  page: Page
}

/** Opens the libretto as `user` and waits until its layers (and so its membership) have synced. */
async function openLibretto(browser: Browser, user: UserKey, contexts: BrowserContext[]) {
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

async function withUsers(
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
async function pageText(page: Page, pageIndex: number) {
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

interface Line {
  /** Mean of the words' vertical centres: where a snapped cue sits. */
  centre: number
  /** Just inside the line's first word. */
  x: number
  /** The first eight words: the quote a cue placed at `x` captures. */
  quote: string
}

/** The `n`th line (zero-based) with at least three words. */
function lineOf(layer: WordLayer, n: number): Line {
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
async function clientPoint(page: Page, pageIndex: number, x: number, y: number) {
  const { width, height } = await pageText(page, pageIndex)
  const sheet = page.locator(`[data-page-index="${pageIndex}"]`)
  const box = await sheet.boundingBox()
  if (!box) throw new Error(`page ${pageIndex} not on screen`)
  const zoom = box.width / width
  return { x: box.x + x * zoom, y: box.y + (height - y) * zoom }
}

async function clickAt(page: Page, pageIndex: number, x: number, y: number) {
  const p = await clientPoint(page, pageIndex, x, y)
  await page.mouse.click(p.x, p.y)
}

interface LocalCue {
  id: string
  department_id: string
  major: number
  minor: number
  label: string
  anchor: Anchor | null
}

/** A cue as the page's local database holds it, or null. */
async function localCue(page: Page, id: string): Promise<LocalCue | null> {
  const rows = await page.evaluate(
    async (cueId) =>
      (await window.__binder?.db.getAll<Record<string, unknown>>(
        'SELECT id, department_id, major, minor, label, anchor FROM cues WHERE id = ?',
        [cueId],
      )) ?? [],
    id,
  )
  const row = rows[0]
  if (!row) return null
  return {
    ...(row as unknown as LocalCue),
    anchor: row.anchor ? JSON.parse(String(row.anchor)) : null,
  }
}

/** The ids of every cue on the libretto's version, in the page's local database. */
async function versionCueIds(page: Page): Promise<string[]> {
  const { libretto } = readRun()
  return page.evaluate(
    async (versionId) =>
      (
        (await window.__binder?.db.getAll<{ id: string }>(
          `SELECT id FROM cues WHERE json_extract(anchor, '$.documentVersionId') = ?`,
          [versionId],
        )) ?? []
      ).map((r) => r.id),
    libretto.versionId,
  )
}

const marker = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"]`)
const selected = (page: Page) => page.locator('[data-cue-id][data-selected="true"]')

async function selectedId(page: Page): Promise<string> {
  await expect(selected(page)).toHaveCount(1)
  return (await selected(page).getAttribute('data-cue-id')) ?? ''
}

/** Places a cue with the cue tool on `line` of a page, and returns its id once it is selected. */
async function placeWithTool(page: Page, pageIndex: number, line: Line): Promise<string> {
  const tool = page.getByRole('button', { name: 'Cue tool' })
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
  const before = await versionCueIds(page)
  await clickAt(page, pageIndex, line.x, line.centre - 3)
  await expect.poll(async () => (await versionCueIds(page)).length).toBe(before.length + 1)
  const id = (await versionCueIds(page)).find((c) => !before.includes(c)) ?? ''
  await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
  return id
}

test('A places an LX cue snapped to a line on page 1 and B sees it within 5s', async ({
  browser,
}) => {
  const { departments, libretto } = readRun()
  await withUsers(browser, ['owner', 'sndEditor'], async ([a, b]) => {
    await a.page.getByLabel('Active layer LX').check()
    const { words } = await pageText(a.page, 0)
    const line = lineOf(words, 2)

    // Click 3 points below the line's centre with the cue tool: the editor opens on LX 10.
    const id = await placeWithTool(a.page, 0, line)
    const editor = a.page.getByRole('region', { name: 'Cue editor' })
    await expect(editor.getByRole('heading')).toHaveText('LX 10')
    await expect(editor.getByLabel('Number')).toHaveValue('10')

    // The local row snapped to the line: its centre, its quote, placed by hand.
    const row = await localCue(a.page, id)
    expect(row?.department_id).toBe(departments.LX)
    expect([row?.major, row?.minor]).toEqual([10, 0])
    expect(row?.anchor?.documentId).toBe(libretto.documentId)
    expect(row?.anchor?.documentVersionId).toBe(libretto.versionId)
    expect(row?.anchor?.pageIndex).toBe(0)
    expect(row?.anchor?.y).toBeCloseTo(line.centre, 6)
    expect(row?.anchor?.text?.quote).toBe(line.quote)
    expect(row?.anchor?.text?.quote.length).toBeGreaterThan(0)
    expect(row?.anchor?.status).toBe('ok')

    // B's device draws it, upright, within five seconds.
    const bMarker = marker(b.page, id)
    await expect(bMarker).toBeVisible({ timeout: 5_000 })
    const number = bMarker.locator('text').first()
    await expect(number).toHaveText('LX 10')
    const scaleY = await number.evaluate((t: SVGTextElement) => t.getCTM()?.d ?? 0)
    expect(scaleY).toBeGreaterThan(0)
    const box = await number.boundingBox()
    const lineTop = await clientPoint(b.page, 0, line.x, line.centre)
    // Upright text centred on the line: the line's centre falls inside the text's box.
    expect(box?.y ?? 0).toBeLessThan(lineTop.y)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(lineTop.y)

    // Editing the label in A's editor reaches B's marker.
    await editor.getByLabel('Label').fill('Sunrise')
    await editor.getByLabel('Label').press('Enter')
    await expect.poll(async () => (await localCue(a.page, id))?.label).toBe('Sunrise')
    await expect(bMarker.locator('text').nth(1)).toHaveText('Sunrise', { timeout: 5_000 })
    expect((await localCue(b.page, id))?.label).toBe('Sunrise')

    // The number is read as a cue number: nonsense is refused with a hint, 10.5 is 10 and 50.
    const numberField = editor.getByLabel('Number')
    await numberField.fill('ten')
    await numberField.press('Enter')
    await expect(editor.getByRole('alert')).toHaveText('Cue numbers look like 10, 10.5, or 0.50.')
    expect([(await localCue(a.page, id))?.major, (await localCue(a.page, id))?.minor]).toEqual([
      10, 0,
    ])
    await numberField.fill('10.5')
    await numberField.press('Enter')
    await expect(editor.getByRole('alert')).toHaveCount(0)
    await expect(editor.getByRole('heading')).toHaveText('LX 10.5')
    await expect(number).toHaveText('LX 10.5', { timeout: 5_000 })
    const renumbered = await localCue(b.page, id)
    expect([renumbered?.major, renumbered?.minor]).toEqual([10, 50])
  })
})

test('dragging the cue to page 2 moves it for both users', async ({ browser }) => {
  await withUsers(browser, ['owner', 'sndEditor'], async ([a, b]) => {
    // Small enough that pages 1 and 2 are both on screen.
    for (const p of [a.page, b.page]) {
      const level = p.getByRole('toolbar', { name: 'Viewer' }).getByLabel('Zoom level')
      while (Number.parseInt((await level.textContent()) ?? '0', 10) > 67) {
        await p.getByRole('button', { name: 'Zoom out' }).click()
      }
      await expect(p.locator('[data-page-index="1"] .markup-surface')).toBeInViewport()
    }
    await a.page.getByLabel('Active layer LX').check()
    const page1 = lineOf((await pageText(a.page, 0)).words, 4)
    const page2 = lineOf((await pageText(a.page, 1)).words, 1)
    const id = await placeWithTool(a.page, 0, page1)

    // Drag the selected marker onto a line of page 2.
    const from = await a.page.locator(`[data-cue-id="${id}"] rect.cue-marker-box`).boundingBox()
    if (!from) throw new Error('marker not on screen')
    const to = await clientPoint(a.page, 1, page2.x, page2.centre + 4)
    await a.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await a.page.mouse.down()
    await a.page.mouse.move(to.x, to.y, { steps: 12 })
    await expect(a.page.locator('.cue-drag-ghost')).toBeVisible()
    await a.page.mouse.up()
    await expect(a.page.locator('.cue-drag-ghost')).toHaveCount(0)

    // Re-snapped to page 2's line, with that line's text, placed by hand.
    await expect.poll(async () => (await localCue(a.page, id))?.anchor?.pageIndex).toBe(1)
    const moved = (await localCue(a.page, id))?.anchor
    expect(moved?.y).toBeCloseTo(page2.centre, 6)
    expect(moved?.text?.quote).toBe(page2.quote)
    expect(moved?.status).toBe('ok')
    await expect(a.page.locator(`[data-page-index="1"] [data-cue-id="${id}"]`)).toBeVisible()
    await expect(a.page.locator(`[data-page-index="0"] [data-cue-id="${id}"]`)).toHaveCount(0)

    // B gets the same anchor and draws the marker on page 2.
    await expect
      .poll(async () => (await localCue(b.page, id))?.anchor, { timeout: 5_000 })
      .toEqual(moved)
    await expect(b.page.locator(`[data-page-index="1"] [data-cue-id="${id}"]`)).toBeVisible()
    await expect(b.page.locator(`[data-page-index="0"] [data-cue-id="${id}"]`)).toHaveCount(0)
  })
})

test("B (SND only) cannot drag A's LX cue and has SND and personal as the only active layers", async ({
  browser,
}) => {
  await withUsers(browser, ['owner', 'sndEditor'], async ([a, b]) => {
    await a.page.getByLabel('Active layer LX').check()
    const line = lineOf((await pageText(a.page, 0)).words, 6)
    const id = await placeWithTool(a.page, 0, line)
    await expect(marker(b.page, id)).toBeVisible({ timeout: 5_000 })

    // Every layer is listed; only SND and B's personal layer can be made active.
    const layers = b.page.getByRole('region', { name: 'Layers' })
    await expect(layers.getByLabel('Show LX')).toBeChecked()
    const radios = layers.getByRole('radio')
    const enabled: string[] = []
    for (const radio of await radios.all()) {
      if (await radio.isEnabled()) enabled.push((await radio.getAttribute('aria-label')) ?? '')
    }
    expect(enabled.sort()).toEqual(['Active layer Personal', 'Active layer SND'])
    expect(await radios.count()).toBeGreaterThan(2)
    await expect(layers.getByLabel('Active layer SND')).toBeChecked()

    // B can select the LX cue and read it, but not change it.
    const before = await localCue(b.page, id)
    await marker(b.page, id).click()
    await expect(marker(b.page, id)).toHaveAttribute('data-selected', 'true')
    const editor = b.page.getByRole('region', { name: 'Cue editor' })
    await expect(editor).toContainText("You can't edit LX cues.")
    await expect(editor.getByLabel('Label')).toBeDisabled()
    await expect(editor.getByRole('button', { name: 'Delete cue' })).toBeDisabled()

    // Dragging does nothing: no ghost, and the anchor stays put on both devices.
    const from = await b.page.locator(`[data-cue-id="${id}"] rect.cue-marker-box`).boundingBox()
    if (!from) throw new Error('marker not on screen')
    await b.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await b.page.mouse.down()
    await b.page.mouse.move(from.x + 40, from.y + 120, { steps: 8 })
    await expect(b.page.locator('.cue-drag-ghost')).toHaveCount(0)
    await b.page.mouse.up()
    // Delete is refused too.
    await b.page.keyboard.press('Delete')
    await b.page.waitForTimeout(1_500)
    expect(await localCue(b.page, id)).toEqual(before)
    expect((await localCue(a.page, id))?.anchor).toEqual(before?.anchor)
    await expect(marker(b.page, id)).toBeVisible()
  })
})

test('a viewer sees the cue tool disabled with the hint', async ({ browser }) => {
  await withUsers(browser, ['viewer'], async ([v]) => {
    const tool = v.page.getByRole('button', { name: 'Cue tool' })
    await expect(tool).toBeDisabled()
    await expect(tool).toHaveAccessibleDescription(NO_DEPARTMENT_HINT)
    await expect(v.page.getByText(NO_DEPARTMENT_HINT)).toBeVisible()

    // A viewer can still show and hide layers, but only their personal layer can be active.
    const layers = v.page.getByRole('region', { name: 'Layers' })
    await expect(layers.getByLabel('Active layer Personal')).toBeEnabled()
    await expect(layers.getByLabel('Active layer Personal')).toBeChecked()
    await expect(layers.getByLabel('Active layer LX')).toBeDisabled()
    await expect(layers.getByLabel('Show LX')).toBeEnabled()

    // The keyboard cannot place one either.
    const before = await versionCueIds(v.page)
    const line = lineOf((await pageText(v.page, 0)).words, 3)
    const p = await clientPoint(v.page, 0, line.x, line.centre)
    await v.page.mouse.move(p.x, p.y)
    await v.page.keyboard.press('c')
    await v.page.waitForTimeout(1_000)
    expect(await versionCueIds(v.page)).toEqual(before)
  })
})

test('keyboard: c places a cue in the active layer at the pointer, ] selects the next cue, Delete removes it', async ({
  browser,
}) => {
  const { departments } = readRun()
  await withUsers(browser, ['owner', 'sndEditor'], async ([a, b]) => {
    await a.page.getByLabel('Active layer SND').check()
    const line = lineOf((await pageText(a.page, 0)).words, 8)

    // c with the pointer just above a line: an SND cue snapped to it.
    const before = await versionCueIds(a.page)
    const p = await clientPoint(a.page, 0, line.x, line.centre + 2)
    await a.page.mouse.move(p.x, p.y)
    await a.page.keyboard.press('c')
    await expect.poll(async () => (await versionCueIds(a.page)).length).toBe(before.length + 1)
    const id = (await versionCueIds(a.page)).find((c) => !before.includes(c)) ?? ''
    const row = await localCue(a.page, id)
    expect(row?.department_id).toBe(departments.SND)
    expect(row?.anchor?.pageIndex).toBe(0)
    expect(row?.anchor?.y).toBeCloseTo(line.centre, 6)
    expect(row?.anchor?.text?.quote).toBe(line.quote)
    expect(await selectedId(a.page)).toBe(id)
    await expect(
      a.page.getByRole('region', { name: 'Cue editor' }).getByRole('heading'),
    ).toHaveText(/^SND \d+$/)
    await expect
      .poll(async () => (await localCue(b.page, id))?.department_id, { timeout: 5_000 })
      .toBe(departments.SND)

    // ] and [ walk the shown cues in reading order: page, then top to bottom (y descending).
    const { libretto } = readRun()
    const ordered = await a.page.evaluate(
      async (versionId) =>
        (
          (await window.__binder?.db.getAll<{ id: string }>(
            `SELECT c.id FROM cues c JOIN departments d ON d.id = c.department_id
             WHERE json_extract(c.anchor, '$.documentVersionId') = ? AND d.hidden = 0
             ORDER BY json_extract(c.anchor, '$.pageIndex'), json_extract(c.anchor, '$.y') DESC`,
            [versionId],
          )) ?? []
        ).map((r) => r.id),
      libretto.versionId,
    )
    expect(ordered.length).toBeGreaterThan(1)
    expect(ordered).toContain(id)
    await a.page.keyboard.press('Escape')
    await expect(selected(a.page)).toHaveCount(0)
    await a.page.keyboard.press(']')
    expect(await selectedId(a.page)).toBe(ordered[0])
    await a.page.keyboard.press(']')
    expect(await selectedId(a.page)).toBe(ordered[1])
    await a.page.keyboard.press('[')
    expect(await selectedId(a.page)).toBe(ordered[0])
    for (let i = 0; i < ordered.indexOf(id); i++) await a.page.keyboard.press(']')
    expect(await selectedId(a.page)).toBe(id)
    await expect(marker(a.page, id)).toBeInViewport()

    // Delete removes it here and on B's device.
    await a.page.keyboard.press('Delete')
    await expect(marker(a.page, id)).toHaveCount(0)
    expect(await localCue(a.page, id)).toBeNull()
    await expect(a.page.getByRole('region', { name: 'Cue editor' })).toHaveCount(0)
    await expect.poll(() => localCue(b.page, id), { timeout: 5_000 }).toBeNull()
    await expect(marker(b.page, id)).toHaveCount(0)
  })
})

test('hiding LX hides its markers and survives a reload', async ({ browser }) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const words = (await pageText(a.page, 0)).words
    await a.page.getByLabel('Active layer LX').check()
    const lx = await placeWithTool(a.page, 0, lineOf(words, 10))
    await a.page.getByLabel('Active layer SND').check()
    const snd = await placeWithTool(a.page, 0, lineOf(words, 12))

    const layers = a.page.getByRole('region', { name: 'Layers' })

    // A locked layer neither deletes nor places, for this user only.
    await layers.getByLabel('Lock LX').check()
    await marker(a.page, lx).click()
    await expect(marker(a.page, lx)).toHaveAttribute('data-selected', 'true')
    await expect(a.page.getByRole('region', { name: 'Cue editor' })).toContainText(
      'The LX layer is locked.',
    )
    await a.page.keyboard.press('Delete')
    await a.page.waitForTimeout(500)
    expect(await localCue(a.page, lx)).not.toBeNull()
    await layers.getByLabel('Active layer LX').check()
    await expect(a.page.getByRole('button', { name: 'Cue tool' })).toBeDisabled()
    await expect(a.page.getByText('The LX layer is locked.', { exact: true }).first()).toBeVisible()
    await layers.getByLabel('Lock LX').uncheck()
    await expect(a.page.getByRole('button', { name: 'Cue tool' })).toBeEnabled()

    await layers.getByLabel('Show LX').uncheck()
    await expect(marker(a.page, lx)).toHaveCount(0)
    await expect(marker(a.page, snd)).toBeVisible()
    // Hidden markers are gone from the keyboard walk too: no LX marker is drawn at all.
    await expect(a.page.locator('[data-cue-label^="LX "]')).toHaveCount(0)

    await a.page.reload()
    await expect(a.page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 30_000 })
    await expect(marker(a.page, snd)).toBeVisible({ timeout: 20_000 })
    await expect(layers.getByLabel('Show LX')).not.toBeChecked()
    await expect(marker(a.page, lx)).toHaveCount(0)
    expect(await localCue(a.page, lx)).not.toBeNull()

    await layers.getByLabel('Show LX').check()
    await expect(marker(a.page, lx)).toBeVisible()
  })
})
