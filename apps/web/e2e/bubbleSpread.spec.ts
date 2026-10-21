import { expect, type Page, test } from '@playwright/test'
import { readRun } from './env'
import { clickAt, clientPoint, lineOf, pageText, withUsers, zoomOutTo } from './markupHelpers'

/**
 * Crowded margin bubbles spread up and down around their own lines (not only down): three cues
 * placed on one line of the libretto sit 16 pt apart, the middle one level with the line, and each
 * is still a whole bubble on the page that can be selected.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

const marker = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"]`)
const tagBody = (page: Page, id: string) => marker(page, id).locator('.cue-tag-body')

async function versionCueIds(page: Page, versionId: string): Promise<string[]> {
  return page.evaluate(
    async (id) =>
      (
        (await window.__binder?.db.getAll<{ id: string }>(
          `SELECT id FROM cues WHERE json_extract(anchor, '$.documentVersionId') = ?`,
          [id],
        )) ?? []
      ).map((r) => r.id),
    versionId,
  )
}

/** Clicks the cue tool at a point of page 1 and returns the new cue's id once it is selected. */
async function placeAt(page: Page, x: number, y: number): Promise<string> {
  const versionId = readRun().libretto.versionId
  const tool = page.getByRole('button', { name: 'Cue tool' })
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
  const before = await versionCueIds(page, versionId)
  await clickAt(page, 0, x, y)
  await expect
    .poll(async () => (await versionCueIds(page, versionId)).length)
    .toBe(before.length + 1)
  const id = (await versionCueIds(page, versionId)).find((c) => !before.includes(c)) ?? ''
  await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
  return id
}

/** Takes the probe cues off the shared show so the other specs' cue numbers stay theirs. */
async function removeCues(page: Page, ids: string[]): Promise<void> {
  const versionId = readRun().libretto.versionId
  if (ids.length === 0) return
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  for (const id of ids) {
    if (!(await versionCueIds(page, versionId)).includes(id)) continue
    await marker(page, id).click()
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await versionCueIds(page, versionId)).includes(id)).toBe(false)
  }
  // and wait for the removals to reach the server, so the next spec's users do not sync them back
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await window.__binder?.db.get<{ n: number }>('SELECT count(*) AS n FROM ps_crud'))
              ?.n ?? -1,
        ),
      { timeout: 20_000 },
    )
    .toBe(0)
}

test('three cues on one line spread around it: one above, one level, one below, all on the page and selectable', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    const ids: string[] = []
    try {
      await page.getByLabel('Active layer LX').check()
      await zoomOutTo(page)
      const { words, width } = await pageText(page, 0)
      const line = lineOf(words, 4)
      // Three cues at the same point: the same line, the same department.
      for (let i = 0; i < 3; i++) ids.push(await placeAt(page, line.x, line.centre - 3))
      for (const id of ids) await expect(tagBody(page, id)).toBeVisible()

      const sheet = await page.locator('[data-page-index="0"]').boundingBox()
      if (!sheet) throw new Error('page not on screen')
      const zoom = sheet.width / width
      const lineY = (await clientPoint(page, 0, line.x, line.centre)).y

      const boxes = []
      for (const id of ids) {
        const box = await tagBody(page, id).boundingBox()
        if (!box) throw new Error(`no tag for ${id}`)
        boxes.push({ id, centre: box.y + box.height / 2, box })
      }
      const down = [...boxes].sort((p, q) => p.centre - q.centre)
      const [top, mid, low] = down as [
        (typeof down)[number],
        (typeof down)[number],
        (typeof down)[number],
      ]

      // The middle bubble is level with the line, one above and one below, 16 pt apart.
      expect(Math.abs(mid.centre - lineY)).toBeLessThan(1 * zoom + 0.5)
      expect(mid.centre - top.centre).toBeCloseTo(16 * zoom, 0)
      expect(low.centre - mid.centre).toBeCloseTo(16 * zoom, 0)
      expect(top.centre).toBeLessThan(lineY - 8 * zoom)
      expect(low.centre).toBeGreaterThan(lineY + 8 * zoom)
      // In cue order: the first placed is the highest on the page.
      expect(down.map((b) => b.id)).toEqual(ids)

      // Every bubble is whole and inside the page.
      for (const { box } of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(sheet.x - 0.5)
        expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5)
        expect(box.y).toBeGreaterThanOrEqual(sheet.y - 0.5)
        expect(box.y + box.height).toBeLessThanOrEqual(sheet.y + sheet.height + 0.5)
      }

      // A spread cue is still selectable from its own bubble.
      await page.getByRole('button', { name: 'Select', exact: true }).click()
      await page.keyboard.press('Escape')
      for (const id of [ids[0], ids[2]] as string[]) {
        await tagBody(page, id).click()
        await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
      }
    } finally {
      await removeCues(page, ids.filter(Boolean))
    }
  })
})
