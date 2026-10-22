import { randomUUID } from 'node:crypto'
import type { Anchor } from '@binder/shared'
import { expect, type Page, test } from '@playwright/test'
import { NO_DEPARTMENT_HINT } from '../src/markup/activeDepartment'
import { readRun, storageStateFor } from './env'
import {
  clickAt,
  clientPoint,
  type Line,
  lineOf,
  pageText,
  selectTool,
  triggerOf,
  withUsers,
  zoomOutTo,
} from './markupHelpers'

/**
 * Cue markup on the short libretto (three text pages) that global setup uploaded. Every write goes
 * through the viewer's tools into the local PowerSync database and syncs to a second user's device.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

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

/**
 * Places an underlined cue with the cue tool on `line` of a page, and returns its id once it is
 * selected. The tool's default (Auto) draws a line on a click; these specs are about the underline
 * (its words, its connector), so it is chosen explicitly. markStyles.spec covers Auto.
 */
async function placeWithTool(page: Page, pageIndex: number, line: Line): Promise<string> {
  const tool = page.getByRole('button', { name: 'Cue tool' })
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
  await page.getByLabel('Cue mark').selectOption('underline')
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

    // B's device draws it, upright, within five seconds, as a named control: an opaque tag with the
    // department code and the number, the label only in its accessible name and hover title.
    const bMarker = marker(b.page, id)
    await expect(bMarker).toBeVisible({ timeout: 5_000 })
    await expect(b.page.getByRole('button', { name: 'LX 10, page 1', exact: true })).toBeVisible()
    const lead = bMarker.locator('text').first()
    await expect(bMarker.locator('text')).toHaveText(['LX', '10'])
    const scaleY = await lead.evaluate((t: SVGTextElement) => t.getCTM()?.d ?? 0)
    expect(scaleY).toBeGreaterThan(0)
    const box = await lead.boundingBox()
    const lineTop = await clientPoint(b.page, 0, line.x, line.centre)
    // Upright text centred on the line: the line's centre falls inside the text's box.
    expect(box?.y ?? 0).toBeLessThan(lineTop.y)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(lineTop.y)
    // The tag sits in the left margin, clear of the line's words, which are underlined instead.
    const tagBox = await bMarker.locator('rect.cue-tag-body').boundingBox()
    expect((tagBox?.x ?? 0) + (tagBox?.width ?? 0)).toBeLessThan(lineTop.x)
    await expect(b.page.locator(`[data-cue-trigger="${id}"] line.cue-underline`)).toHaveCount(1)

    // Editing the label in A's editor reaches B's marker, in its name and hover title.
    await editor.getByLabel('Label').fill('Sunrise')
    await editor.getByLabel('Label').press('Enter')
    await expect.poll(async () => (await localCue(a.page, id))?.label).toBe('Sunrise')
    await expect(
      b.page.getByRole('button', { name: 'LX 10, Sunrise, page 1', exact: true }),
    ).toBeVisible({ timeout: 5_000 })
    await expect(bMarker.locator('title')).toHaveText('LX 10, Sunrise')
    await expect(bMarker.locator('text')).toHaveText(['LX', '10'])
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
    // The wider number no longer fits this page's narrow margin beside the code, so the tag sheds
    // the code (the name and the colour still say LX) and never enters the text.
    await expect(bMarker.locator('text').last()).toHaveText('10.5', { timeout: 5_000 })
    const renumbered = await localCue(b.page, id)
    expect([renumbered?.major, renumbered?.minor]).toEqual([10, 50])
    await expect(
      b.page.getByRole('button', { name: 'LX 10.5, Sunrise, page 1', exact: true }),
    ).toBeVisible()

    // Escape in a field abandons the draft and keeps the cue selected; a second Escape deselects.
    const labelField = editor.getByLabel('Label')
    await labelField.fill('Abandoned draft')
    await labelField.press('Escape')
    await expect(labelField).toHaveValue('Sunrise')
    await expect(labelField).not.toBeFocused()
    await expect(marker(a.page, id)).toHaveAttribute('data-selected', 'true')
    await a.page.waitForTimeout(500)
    expect((await localCue(a.page, id))?.label).toBe('Sunrise')
    await a.page.keyboard.press('Escape')
    await expect(selected(a.page)).toHaveCount(0)
    await expect(editor).toHaveCount(0)
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

    // Drag the selected cue's mark (its underlined words) onto a line of page 2.
    await selectTool(a.page)
    const from = await triggerOf(a.page, id).boundingBox()
    if (!from) throw new Error('mark not on screen')
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

test('dragging the bubble moves only the bubble, Alt+arrow keys nudge it, and plain arrows still turn the page', async ({
  browser,
}) => {
  await withUsers(browser, ['owner', 'sndEditor'], async ([a, b]) => {
    await a.page.getByLabel('Active layer LX').check()
    await zoomOutTo(a.page)
    const { words } = await pageText(a.page, 0)
    const id = await placeWithTool(a.page, 0, lineOf(words, 3))
    await expect(marker(b.page, id)).toBeVisible({ timeout: 5_000 })
    const before = (await localCue(a.page, id))?.anchor
    expect(before?.tag).toBeUndefined()
    const centreOf = async (page: Page) => {
      const box = await marker(page, id).locator('rect.cue-tag-body').boundingBox()
      if (!box) throw new Error('tag not on screen')
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }

    // Drag the selected tag onto the text a good way from its line.
    const start = await centreOf(a.page)
    const target = await clientPoint(a.page, 0, 300, lineOf(words, 8).centre)
    await a.page.mouse.move(start.x, start.y)
    await a.page.mouse.down()
    await a.page.mouse.move(target.x, target.y, { steps: 12 })
    // Mid-drag the pill is previewed at the pointer; the cue's mark has not moved.
    await expect(a.page.locator('.cue-bubble-preview')).toHaveCount(1)
    await expect(a.page.locator('.cue-drag-ghost')).toHaveCount(0)
    await a.page.mouse.up()

    // Only the tag changed: x, y, text and everything else are as placed.
    await expect.poll(async () => (await localCue(a.page, id))?.anchor?.tag).toBeDefined()
    const after = (await localCue(a.page, id))?.anchor
    const { tag, ...rest } = after ?? ({} as Anchor)
    expect(rest).toEqual(before)
    expect(after?.x).toBe(before?.x)
    expect(after?.y).toBe(before?.y)
    expect(after?.text).toEqual(before?.text)
    // The pill is now drawn where it was dropped (it was picked up by its centre).
    await expect(a.page.locator('.cue-bubble-preview')).toHaveCount(0)
    await expect
      .poll(async () => {
        const c = await centreOf(a.page)
        return Math.hypot(c.x - target.x, c.y - target.y)
      })
      .toBeLessThan(2)
    // B draws it there too, with the same tag.
    await expect
      .poll(async () => (await localCue(b.page, id))?.anchor?.tag, { timeout: 5_000 })
      .toEqual(tag)

    // The keyboard: with the tag focused, Alt+ArrowDown three times and Alt+Shift+ArrowRight once.
    await marker(a.page, id).focus()
    const scrollTop = () =>
      a.page.evaluate(
        () => document.querySelector('[data-page-index="0"]')?.getBoundingClientRect().top ?? 0,
      )
    const top = await scrollTop()
    await a.page.keyboard.press('Alt+ArrowDown')
    await expect
      .poll(async () => (await localCue(a.page, id))?.anchor?.tag?.dy)
      .toBeCloseTo((tag?.dy ?? 0) - 1, 1)
    await a.page.keyboard.press('Alt+ArrowDown')
    await a.page.keyboard.press('Alt+ArrowDown')
    await a.page.keyboard.press('Alt+Shift+ArrowRight')
    await expect
      .poll(async () => (await localCue(a.page, id))?.anchor?.tag)
      .toEqual({
        dx: expect.closeTo((tag?.dx ?? 0) + 10, 1),
        dy: expect.closeTo((tag?.dy ?? 0) - 3, 1),
      })
    expect(await scrollTop()).toBe(top)
    // Still the same cue, still not moved.
    expect((await localCue(a.page, id))?.anchor?.x).toBe(before?.x)
    expect((await localCue(a.page, id))?.anchor?.y).toBe(before?.y)

    // A plain arrow on the focused tag is not a nudge: it turns the page, as it did before bubbles moved.
    const nudged = (await localCue(a.page, id))?.anchor?.tag
    const position = a.page.getByLabel('Page position')
    await expect(position).toHaveText(/^1 \//)
    await marker(a.page, id).focus()
    await a.page.keyboard.press('ArrowRight')
    await expect(position).toHaveText(/^2 \//)
    await a.page.waitForTimeout(600)
    expect((await localCue(a.page, id))?.anchor?.tag).toEqual(nudged)
    // `]` walks to the cue, selects it and focuses its tag (and shows its page); the arrow then turns
    // the page, not the bubble.
    await a.page.keyboard.press('Escape')
    for (let n = 0; n < 12; n += 1) {
      await a.page.keyboard.press(']')
      if ((await marker(a.page, id).getAttribute('aria-pressed')) === 'true') break
    }
    await expect(marker(a.page, id)).toBeFocused()
    await expect(position).toHaveText(/^1 \//)
    await a.page.keyboard.press('ArrowRight')
    await expect(position).toHaveText(/^2 \//)
    await a.page.waitForTimeout(600)
    expect((await localCue(a.page, id))?.anchor?.tag).toEqual(nudged)

    await marker(a.page, id).focus()
    await a.page.keyboard.press('Delete')
    await expect.poll(() => localCue(a.page, id)).toBeNull()
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
    const from = await triggerOf(b.page, id).boundingBox()
    if (!from) throw new Error('mark not on screen')
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

test("an owner sets SND to the right and an SND cue's tag renders in the right margin for another member", async ({
  browser,
}) => {
  const { sharedShow } = readRun()
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    // Everyone's markers come from the show's settings, which the owner changes on the settings page.
    const settings = await a.context.newPage()
    await settings.goto(`/shows/${sharedShow.id}/settings`)
    const sndSide = settings.getByRole('radiogroup', { name: 'SND marker side' })
    await expect(sndSide.getByRole('radio', { name: 'Left' })).toBeChecked({ timeout: 20_000 })
    let id = ''
    try {
      await sndSide.getByRole('radio', { name: 'Right' }).click()
      await expect(sndSide.getByRole('radio', { name: 'Right' })).toBeChecked()

      await a.page.getByLabel('Active layer SND').check()
      id = await placeWithTool(a.page, 0, lineOf((await pageText(a.page, 0)).words, 5))
      await expect(marker(b.page, id)).toBeVisible({ timeout: 10_000 })

      // On B's device the tag is flush in the page's right margin, past the middle of the sheet and
      // within a few points of the right edge; an LX tag on the same page is still on the left.
      const sheet = await b.page.locator('[data-page-index="0"]').boundingBox()
      const tag = await marker(b.page, id).locator('rect.cue-tag-body').boundingBox()
      if (!sheet || !tag) throw new Error('page or tag not on screen')
      const zoom = sheet.width / (await pageText(b.page, 0)).width
      expect(tag.x).toBeGreaterThan(sheet.x + sheet.width / 2)
      expect(sheet.x + sheet.width - (tag.x + tag.width)).toBeLessThan(6 * zoom)
      expect(sheet.x + sheet.width - (tag.x + tag.width)).toBeGreaterThan(2 * zoom)

      // Its connector runs from the underlined words out to the tag: the underline ends left of the tag.
      const highlight = await b.page
        .locator(`[data-cue-trigger="${id}"] line.cue-underline`)
        .first()
        .boundingBox()
      expect((highlight?.x ?? 0) + (highlight?.width ?? 0)).toBeLessThan(tag.x)

      // Back on the left, B's tag follows.
      await sndSide.getByRole('radio', { name: 'Left' }).click()
      await expect(sndSide.getByRole('radio', { name: 'Left' })).toBeChecked()
      await expect
        .poll(
          async () => (await marker(b.page, id).locator('rect.cue-tag-body').boundingBox())?.x,
          {
            timeout: 10_000,
          },
        )
        .toBeLessThan(sheet.x + sheet.width / 2)
    } finally {
      await sndSide.getByRole('radio', { name: 'Left' }).click()
      await expect(sndSide.getByRole('radio', { name: 'Left' })).toBeChecked()
      if (id) {
        await marker(a.page, id).click()
        await a.page.keyboard.press('Delete')
        await expect(marker(a.page, id)).toHaveCount(0, { timeout: 5_000 })
      }
    }
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

test('opening ?cue= scrolls to the cue and leaves its tag inside the viewport, clear of the tool strip', async ({
  browser,
}) => {
  const { sharedShow, departments, libretto: doc } = readRun()
  await withUsers(browser, ['owner'], async ([a]) => {
    const id = randomUUID()
    try {
      // On page 3, below the fold of a page 1 start.
      await a.page.evaluate(
        async (c) => {
          const now = new Date().toISOString()
          const anchor = JSON.stringify({
            documentId: c.documentId,
            documentVersionId: c.versionId,
            pageIndex: 2,
            x: 200,
            y: 300,
            status: 'ok',
          })
          await window.__binder?.db.execute(
            `INSERT INTO cues (id, show_id, department_id, major, minor, label, anchor, type, notes,
                               colour, payload, created_at, updated_at, updated_by)
             VALUES (?, ?, ?, 78, 0, 'Focus', ?, 'go', '', NULL, '{}', ?, ?, NULL)`,
            [c.id, c.showId, c.departmentId, anchor, now, now],
          )
        },
        {
          id,
          showId: sharedShow.id,
          departmentId: departments.LX,
          documentId: doc.documentId,
          versionId: doc.versionId,
        },
      )
      await a.page.goto(`/shows/${sharedShow.id}/docs/${doc.documentId}?cue=${id}`)
      await expect(marker(a.page, id)).toHaveAttribute('data-selected', 'true', {
        timeout: 30_000,
      })
      const tag = marker(a.page, id).locator('rect.cue-tag-body')
      await expect(tag).toBeInViewport({ ratio: 1 })
      // The floating strip sits in its own lane at the stage's left edge: it never covers a tag.
      const strip = await a.page.getByRole('group', { name: 'Markup tools' }).boundingBox()
      const box = await tag.boundingBox()
      if (!strip || !box) throw new Error('strip or tag not on screen')
      expect(box.x).toBeGreaterThanOrEqual(strip.x + strip.width)
    } finally {
      await a.page.evaluate(async (cueId) => {
        await window.__binder?.db.execute('DELETE FROM cues WHERE id = ?', [cueId])
      }, id)
    }
  })
})

test('on a short window every tool in the strip is still reachable', async ({ browser }) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    // Find in document is the strip's last tool (undo and redo are in the top bar and snap to text
    // is in the status bar, so they are not the strip's to reach).
    const find = a.page.getByRole('button', { name: 'Find in document' })
    const search = a.page.getByRole('searchbox', { name: 'Search document' })
    for (const viewport of [
      { width: 1024, height: 600 },
      { width: 1280, height: 640 },
    ]) {
      await a.page.setViewportSize(viewport)
      // The strip stays inside the stage (it shrinks or scrolls itself), so the last tool can be
      // reached by the user and not only by a script that scrolls the layout behind it.
      const stage = await a.page.locator('.viewer-pages').boundingBox()
      const strip = await a.page.getByRole('group', { name: 'Markup tools' }).boundingBox()
      if (!stage || !strip) throw new Error('stage or strip not on screen')
      expect(strip.y).toBeGreaterThanOrEqual(stage.y)
      expect(strip.y + strip.height).toBeLessThanOrEqual(stage.y + stage.height)
      // A real click on the last tool lands (Playwright scrolls the strip itself if it must) and
      // does what the tool does: it puts the cursor in the search box.
      await find.click()
      const tool = await find.boundingBox()
      if (!tool) throw new Error('last tool not on screen')
      expect(tool.y).toBeGreaterThanOrEqual(stage.y)
      expect(tool.y + tool.height).toBeLessThanOrEqual(stage.y + stage.height)
      await expect(search).toBeFocused()
      await a.page.getByRole('button', { name: 'Select', exact: true }).focus()
    }
  })
})

test('snap to text is the status bar word: clicking it toggles it, and so does the keyboard', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const snap = a.page.getByLabel('Snap to text')
    const bar = a.page.getByRole('region', { name: 'Script status' })
    const before = await snap.isChecked()
    await bar.getByText('Snap to text').click()
    await expect(snap).toBeChecked({ checked: !before })
    await snap.focus()
    await a.page.keyboard.press('Space')
    await expect(snap).toBeChecked({ checked: before })
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

    // Markers are reachable without a pointer: Tab from the pages lands on the first, Enter selects
    // it, and the choice is announced.
    await a.page.getByRole('region', { name: 'Pages' }).focus()
    await a.page.keyboard.press('Tab')
    const focused = a.page.locator('[data-cue-id]:focus')
    await expect(focused).toHaveAttribute('data-cue-id', ordered[0] ?? '')
    await expect(focused).toHaveAttribute('role', 'button')
    await a.page.keyboard.press('Enter')
    expect(await selectedId(a.page)).toBe(ordered[0])
    await expect(focused).toHaveAttribute('aria-pressed', 'true')
    const name = (await focused.getAttribute('aria-label')) ?? ''
    await expect(a.page.getByRole('status').filter({ hasText: 'Selected' })).toHaveText(
      `Selected ${name}`,
    )
    await a.page.keyboard.press('Escape')
    await expect(selected(a.page)).toHaveCount(0)
    await expect(a.page.getByRole('status').filter({ hasText: 'selected' })).toHaveText(
      'No cue selected',
    )

    await a.page.keyboard.press(']')
    expect(await selectedId(a.page)).toBe(ordered[0])
    await a.page.keyboard.press(']')
    expect(await selectedId(a.page)).toBe(ordered[1])
    // Focus follows the walk.
    await expect(a.page.locator('[data-cue-id]:focus')).toHaveAttribute(
      'data-cue-id',
      ordered[1] ?? '',
    )
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
    await layers.getByLabel('Active layer SND').check()

    await layers.getByLabel('Show LX').uncheck()
    await expect(marker(a.page, lx)).toHaveCount(0)
    await expect(marker(a.page, snd)).toBeVisible()
    // The cue tool will not place onto a hidden layer, where the cue would vanish as it lands.
    const tool = a.page.getByRole('button', { name: 'Cue tool' })
    await expect(layers.getByLabel('Active layer SND')).toBeChecked()
    await expect(tool).toBeEnabled()
    await layers.getByLabel('Active layer LX').check()
    await expect(tool).toBeDisabled()
    await expect(tool).toHaveAccessibleDescription('Show the LX layer to place cues on it')
    // Hidden markers are gone from the keyboard walk too: no LX marker is drawn at all.
    await expect(a.page.locator('[data-cue-label^="LX "]')).toHaveCount(0)

    await a.page.reload()
    await expect(a.page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 30_000 })
    await expect(marker(a.page, snd)).toBeVisible({ timeout: 20_000 })
    await expect(layers.getByLabel('Show LX')).not.toBeChecked()
    await expect(marker(a.page, lx)).toHaveCount(0)
    expect(await localCue(a.page, lx)).not.toBeNull()

    await expect(a.page.getByRole('button', { name: 'Cue tool' })).toBeDisabled()

    await layers.getByLabel('Show LX').check()
    await expect(marker(a.page, lx)).toBeVisible()
    await expect(a.page.getByRole('button', { name: 'Cue tool' })).toBeEnabled()
  })
})

test('a drag ends cleanly when a collaborator deletes the cue mid-drag', async ({ browser }) => {
  await withUsers(browser, ['owner', 'sndEditor'], async ([a, b]) => {
    await a.page.getByLabel('Active layer SND').check()
    const id = await placeWithTool(a.page, 0, lineOf((await pageText(a.page, 0)).words, 14))
    await expect(marker(b.page, id)).toBeVisible({ timeout: 5_000 })

    // A picks the selected cue's mark up and holds it.
    await selectTool(a.page)
    const from = await triggerOf(a.page, id).boundingBox()
    if (!from) throw new Error('mark not on screen')
    await a.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await a.page.mouse.down()
    await a.page.mouse.move(from.x + 60, from.y + 80, { steps: 6 })
    await expect(a.page.locator('.cue-drag-ghost')).toBeVisible()

    // B (SND editor) deletes it meanwhile.
    await marker(b.page, id).click()
    await b.page.keyboard.press('Delete')
    await expect.poll(() => localCue(b.page, id)).toBeNull()

    // A's drag ends as the cue goes, and the release afterwards does nothing.
    await expect(marker(a.page, id)).toHaveCount(0, { timeout: 5_000 })
    await expect(a.page.locator('.cue-drag-ghost')).toHaveCount(0)
    await a.page.mouse.move(from.x + 90, from.y + 120, { steps: 4 })
    await a.page.mouse.up()
    await expect(a.page.locator('.cue-drag-ghost')).toHaveCount(0)
    await a.page.waitForTimeout(500)
    expect(await localCue(a.page, id)).toBeNull()
    await expect(a.page.getByRole('alert')).toHaveCount(0)
  })
})

test('a cue placed on the very bottom of a page lands on that page, not under the next slot', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    await a.page.getByLabel('Active layer LX').check()
    // Small enough that pages 1 and 2 are both on screen, so the next slot is mounted below page 1.
    const level = a.page.getByRole('toolbar', { name: 'Viewer' }).getByLabel('Zoom level')
    while (Number.parseInt((await level.textContent()) ?? '0', 10) > 67) {
      await a.page.getByRole('button', { name: 'Zoom out' }).click()
    }
    await expect(a.page.locator('[data-page-index="1"] .markup-surface')).toBeInViewport()
    const before = await versionCueIds(a.page)
    const tool = a.page.getByRole('button', { name: 'Cue tool' })
    if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
    // Three points (about two pixels at this zoom) above the page's bottom edge, at its middle:
    // inside the bottom 6 px that the next slot's padding used to cover.
    const { width } = await pageText(a.page, 0)
    await clickAt(a.page, 0, width / 2, 3)
    await expect.poll(async () => (await versionCueIds(a.page)).length).toBe(before.length + 1)
    const id = (await versionCueIds(a.page)).find((c) => !before.includes(c)) ?? ''
    try {
      const anchor = (await localCue(a.page, id))?.anchor
      expect(anchor?.pageIndex).toBe(0)
      expect(anchor?.y).toBeLessThan(12)
    } finally {
      await a.page.evaluate(async (cueId) => {
        await window.__binder?.db.execute('DELETE FROM cues WHERE id = ?', [cueId])
      }, id)
    }
  })
})

test('on a phone the page fills the width, Place cue opens the drawer, and Done hands the tag its focus back', async ({
  browser,
}) => {
  const { sharedShow, libretto } = readRun()
  const context = await browser.newContext({
    storageState: storageStateFor('owner'),
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()
  let id = ''
  try {
    await page.goto(`/shows/${sharedShow.id}/docs/${libretto.documentId}`)
    await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible({
      timeout: 30_000,
    })
    // The page fills the width but for its 12 px gutters, and nothing scrolls sideways.
    const sheet = await page.locator('.page-sheet').first().boundingBox()
    expect(sheet?.x).toBeGreaterThanOrEqual(11)
    expect((sheet?.x ?? 0) + (sheet?.width ?? 0)).toBeLessThanOrEqual(390 - 11)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    // Nothing is selected: no drawer, and the red floating button, at least 56 px high.
    await expect(page.getByRole('dialog', { name: 'Context panel' })).toHaveCount(0)
    const place = page.getByRole('button', { name: 'Place cue' })
    await expect(place).toBeEnabled({ timeout: 20_000 })
    expect((await place.boundingBox())?.height).toBeGreaterThanOrEqual(56)

    // Place cue puts a cue at the middle of the page in view and selects it: the drawer opens.
    const before = await versionCueIds(page)
    await place.click()
    await expect.poll(async () => (await versionCueIds(page)).length).toBe(before.length + 1)
    id = (await versionCueIds(page)).find((c) => !before.includes(c)) ?? ''
    const drawer = page.getByRole('dialog', { name: 'Context panel' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab')).toHaveText(['Cue', 'Layers', 'History', 'Review'])
    await expect(place).toHaveCount(0)
    await expect(selected(page)).toHaveAttribute('data-cue-id', id)
    expect((await localCue(page, id))?.anchor?.pageIndex).toBe(0)
    // The drawer covers the tab bar: the bottom of the screen is the sheet's.
    const box = await drawer.boundingBox()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(843)
    // The cue went in at the middle of the page, which the drawer now covers: the page scrolls so
    // the selected tag sits in the part of the screen still seen.
    await expect
      .poll(async () => {
        const tag = await marker(page, id).locator('rect.cue-tag-body').boundingBox()
        return (tag?.y ?? 1e9) + (tag?.height ?? 0)
      })
      .toBeLessThan(box?.y ?? 0)
    // Opening "More fields" grows the drawer over where the tag was: the page follows it up.
    await drawer.getByText('More fields').click()
    await expect
      .poll(async () => {
        const tag = await marker(page, id).locator('rect.cue-tag-body').boundingBox()
        const sheetBox = await drawer.boundingBox()
        return (sheetBox?.y ?? 0) - ((tag?.y ?? 1e9) + (tag?.height ?? 0))
      })
      .toBeGreaterThan(0)
    await drawer.getByText('More fields').click()

    // Edit the label in the drawer, then Done: it closes, and the tag has the focus.
    await drawer.getByLabel('Label').fill('Phone cue')
    await drawer.getByLabel('Label').press('Enter')
    await expect.poll(async () => (await localCue(page, id))?.label).toBe('Phone cue')
    await drawer.getByRole('button', { name: 'Done' }).click()
    await expect(drawer).toHaveCount(0)
    await expect(marker(page, id)).toBeFocused()
    await expect(page.getByRole('button', { name: 'Place cue' })).toBeVisible()

    // Selecting it by its tag opens the drawer on the Cue tab with the label in its field.
    await marker(page, id).locator('rect.cue-tag-body').click()
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: 'Cue' })).toHaveAttribute('aria-selected', 'true')
    await expect(drawer.getByLabel('Label')).toHaveValue('Phone cue')
    await drawer.getByLabel('Label').fill('Phone cue 2')
    await drawer.getByLabel('Label').press('Enter')
    await expect.poll(async () => (await localCue(page, id))?.label).toBe('Phone cue 2')
    await drawer.getByRole('button', { name: 'Done' }).click()
    await expect(drawer).toHaveCount(0)
    await expect(marker(page, id)).toBeFocused()

    // c typed in a drawer field is text, not a place-cue key.
    await marker(page, id).locator('rect.cue-tag-body').click()
    await drawer.getByLabel('Label').fill('')
    await page.keyboard.type('cc')
    await expect(drawer.getByLabel('Label')).toHaveValue('cc')
    expect((await versionCueIds(page)).length).toBe(before.length + 1)
  } finally {
    if (id) {
      await page.evaluate(async (cueId) => {
        await window.__binder?.db.execute('DELETE FROM cues WHERE id = ?', [cueId])
      }, id)
    }
    await context.close()
  }
})

test('opening the Review tab widens the panel to 420 and the page re-fits: no sideways scroll, a chosen zoom stays', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const pages = a.page.getByRole('region', { name: 'Pages' })
    const sheet = a.page.locator('.page-sheet').first()
    const stage = a.page.locator('.viewer-pages')
    const inside = async () => {
      const [s, st] = await Promise.all([sheet.boundingBox(), stage.boundingBox()])
      return (s?.x ?? 0) + (s?.width ?? 0) <= (st?.x ?? 0) + (st?.width ?? 0)
    }
    const noSideways = () => pages.evaluate((el) => el.scrollWidth <= el.clientWidth)
    expect(await noSideways()).toBe(true)
    const narrow = (await sheet.boundingBox())?.width ?? 0

    await a.page.getByRole('tab', { name: /^Review/ }).click()
    await expect.poll(noSideways).toBe(true)
    await expect.poll(inside).toBe(true)
    // the stage lost 120 px: the page is narrower, not scrolled under the panel
    await expect.poll(async () => (await sheet.boundingBox())?.width ?? 0).toBeLessThan(narrow - 90)

    // back to the Cue tab: the page grows into the room again
    await a.page.getByRole('tab', { name: 'Cue' }).click()
    await expect
      .poll(async () => (await sheet.boundingBox())?.width ?? 0)
      .toBeGreaterThan(narrow - 2)

    // a zoom the user chose is theirs: widening the panel leaves it alone
    await a.page.getByRole('button', { name: 'Zoom out' }).click()
    const level = a.page.getByRole('toolbar', { name: 'Viewer' }).getByLabel('Zoom level')
    const chosen = await level.textContent()
    await a.page.getByRole('tab', { name: /^Review/ }).click()
    await a.page.waitForTimeout(500)
    await expect(level).toHaveText(chosen ?? '')
  })
})

test('on a tablet the Find card opens beside the sheet, not behind it', async ({ browser }) => {
  const { sharedShow, libretto, departments } = readRun()
  const context = await browser.newContext({
    storageState: storageStateFor('owner'),
    viewport: { width: 834, height: 1194 },
  })
  const page = await context.newPage()
  const id = randomUUID()
  try {
    await page.goto(`/shows/${sharedShow.id}/docs/${libretto.documentId}`)
    await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible({
      timeout: 30_000,
    })
    await page.evaluate(
      async ({ id, show, doc, ver, dept }) => {
        const now = new Date().toISOString()
        const anchor = JSON.stringify({
          documentId: doc,
          documentVersionId: ver,
          pageIndex: 0,
          x: 120,
          y: 600,
          status: 'ok',
        })
        await window.__binder?.db.execute(
          `INSERT INTO cues (id, show_id, department_id, major, minor, label, anchor, type, notes, colour, payload, created_at, updated_at, updated_by) VALUES (?, ?, ?, 77, 0, 'Find test', ?, 'go', '', NULL, '{}', ?, ?, NULL)`,
          [id, show, dept, anchor, now, now],
        )
      },
      {
        id,
        show: sharedShow.id,
        doc: libretto.documentId,
        ver: libretto.versionId,
        dept: departments.LX,
      },
    )
    await marker(page, id).locator('rect.cue-tag-body').click()
    const sheet = page.getByRole('dialog', { name: 'Context panel' })
    await expect(sheet).toBeVisible()
    // `/` with the cue selected (focus is on its tag): the box must be where it can be seen
    await page.keyboard.press('/')
    const box = page.getByRole('searchbox', { name: 'Search document' })
    await expect(box).toBeFocused()
    await expect(box).toBeInViewport({ ratio: 1 })
    expect(
      await box.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
      }),
    ).toBe(true)
    const [boxRect, sheetRect] = await Promise.all([box.boundingBox(), sheet.boundingBox()])
    expect((boxRect?.x ?? 0) + (boxRect?.width ?? 0)).toBeLessThanOrEqual(sheetRect?.x ?? 0)
  } finally {
    await page.evaluate(async (cueId) => {
      await window.__binder?.db.execute('DELETE FROM cues WHERE id = ?', [cueId])
    }, id)
    await context.close()
  }
})

test('on a phone a drawer opened from the menu has a Done, and focus goes back to the menu button', async ({
  browser,
}) => {
  const { sharedShow, libretto } = readRun()
  const context = await browser.newContext({
    storageState: storageStateFor('owner'),
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()
  try {
    await page.goto(`/shows/${sharedShow.id}/docs/${libretto.documentId}`)
    await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible({
      timeout: 30_000,
    })
    const menu = page.getByRole('button', { name: 'Document options' })
    await menu.click()
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Context panel' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: 'Layers' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const done = drawer.getByRole('button', { name: 'Done' })
    expect((await done.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await done.click()
    await expect(drawer).toHaveCount(0)
    await expect(menu).toBeFocused()
  } finally {
    await context.close()
  }
})
