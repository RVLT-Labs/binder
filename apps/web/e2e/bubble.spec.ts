import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Anchor } from '@binder/shared'
import { expect, type Page, test } from '@playwright/test'
import { readRun } from './env'
import { clickAt, clientPoint, lineOf, pageText, withUsers, zoomOutTo } from './markupHelpers'

/**
 * A cue's bubble defaults to the margin and can be moved: dragged onto the text (it stays through a
 * reload), put back with the cue editor's Reset to margin (the stored `tag` key goes), read in the
 * cue's History as "Bubble moved". A second test prints it where it was put with no note.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

const NOTE = 'Zqbubblenote'

const marker = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"]`)
const tagBody = (page: Page, id: string) => marker(page, id).locator('rect.cue-tag-body')
const cueEditor = (page: Page) => page.getByRole('region', { name: 'Cue editor' })

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** A cue's stored anchor in the page's local database, or null. */
async function storedAnchor(page: Page, id: string): Promise<Anchor | null> {
  const rows = await page.evaluate(
    async (cueId) =>
      (await window.__binder?.db.getAll<{ anchor: string | null }>(
        'SELECT anchor FROM cues WHERE id = ?',
        [cueId],
      )) ?? [],
    id,
  )
  const raw = rows[0]?.anchor
  return raw ? (JSON.parse(raw) as Anchor) : null
}

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

/** Waits until everything the page wrote locally has been uploaded. */
async function uploaded(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => (await window.__binder?.db.getUploadQueueStats())?.count ?? 0),
      { timeout: 20_000 },
    )
    .toBe(0)
}

async function placeCue(page: Page, x: number, y: number): Promise<string> {
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

/** The centre of the cue's bubble on screen. */
async function bubbleCentre(page: Page, id: string) {
  const box = await tagBody(page, id).boundingBox()
  if (!box) throw new Error('bubble not on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Takes the probe cue off the shared show so the other specs' cue numbers stay theirs. */
async function removeCue(page: Page, id: string): Promise<void> {
  const versionId = readRun().libretto.versionId
  if (!id || !(await versionCueIds(page, versionId)).includes(id)) return
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await tagBody(page, id).click()
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await versionCueIds(page, versionId)).includes(id)).toBe(false)
  await uploaded(page)
}

interface PdfWord {
  text: string
  /** The word's centre as a fraction of the page: x from the left, y from the top. */
  fx: number
  fy: number
}

/** The words of page 1 of a PDF with their centres as page fractions (poppler's bbox output). */
function pdfWords(path: string): PdfWord[] {
  const html = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', path, '-'], {
    encoding: 'utf8',
  })
  const page = /<page width="([\d.]+)" height="([\d.]+)"/.exec(html)
  if (!page) throw new Error('no page in the bbox output')
  const width = Number(page[1])
  const height = Number(page[2])
  const words: PdfWord[] = []
  const re =
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, x0, y0, x1, y1, text] = m
    words.push({
      text: text ?? '',
      fx: (Number(x0) + Number(x1)) / 2 / width,
      fy: (Number(y0) + Number(y1)) / 2 / height,
    })
  }
  return words
}

/** Prints the calling script with every layer and saves the PDF. */
async function exportPdf(page: Page, saveAs: string): Promise<void> {
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print' })
  await dialog.getByRole('button', { name: 'Calling script: all layers' }).click()
  await expect(dialog.getByRole('img', { name: /^Preview:/ })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PDF' }).click(),
  ])
  await expect(dialog).toBeHidden()
  await download.saveAs(saveAs)
}

/** Puts an LX cue on page 1 with a note, as the owner, and returns it with the page's words. */
async function placeCueWithNote(page: Page) {
  await page.getByLabel('Active layer LX').check()
  await zoomOutTo(page)
  const { words, width, height } = await pageText(page, 0)
  const id = await placeCue(page, lineOf(words, 3).x, lineOf(words, 3).centre - 3)
  // A note, so print has something to leave out when the bubble leaves the margin.
  await cueEditor(page).getByLabel('Notes').fill(NOTE)
  await cueEditor(page).getByLabel('Notes').blur()
  await expect
    .poll(async () =>
      page.evaluate(
        async (cueId) =>
          (
            await window.__binder?.db.get<{ notes: string }>(
              'SELECT notes FROM cues WHERE id = ?',
              [cueId],
            )
          )?.notes,
        id,
      ),
    )
    .toBe(NOTE)
  return { id, words, width, height }
}

/** Drags the selected bubble onto the text, well away from its line and out of the margin. */
async function dragBubbleOntoText(
  page: Page,
  id: string,
  at: { words: Awaited<ReturnType<typeof pageText>>['words']; width: number },
) {
  const start = await bubbleCentre(page, id)
  const target = await clientPoint(page, 0, at.width * 0.55, lineOf(at.words, 9).centre)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 14 })
  await page.mouse.up()
  await expect.poll(async () => (await storedAnchor(page, id))?.tag).toBeDefined()
  return target
}

test('move a bubble onto the text: it stays through a reload, shows in History as "Bubble moved", and Reset to margin returns it', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    let id = ''
    try {
      const placedCue = await placeCueWithNote(page)
      id = placedCue.id

      // In the margin to begin with: no tag, and the editor says so in words.
      const placed = await storedAnchor(page, id)
      expect(placed?.tag).toBeUndefined()
      const bubbleRow = cueEditor(page).getByRole('group', { name: 'Bubble' })
      await expect(bubbleRow).toContainText('In the margin')
      await expect(bubbleRow.getByRole('button', { name: 'Reset to margin' })).toHaveCount(0)

      const target = await dragBubbleOntoText(page, id, placedCue)
      const moved = (await storedAnchor(page, id)) as Anchor
      const tag = moved.tag as { dx: number; dy: number }
      // Only the bubble moved: the cue is where it was placed.
      expect({ ...moved, tag: undefined }).toEqual({ ...placed, tag: undefined })
      expect(Math.abs(tag.dx)).toBeGreaterThan(50)
      expect(Math.abs(tag.dy)).toBeGreaterThan(20)
      await expect
        .poll(async () => {
          const c = await bubbleCentre(page, id)
          return Math.hypot(c.x - target.x, c.y - target.y)
        })
        .toBeLessThan(2)
      await expect(bubbleRow).toContainText('Moved')
      await uploaded(page)

      // It stays through a reload.
      await page.reload()
      await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('/ 3', {
        timeout: 30_000,
      })
      await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible()
      await expect(marker(page, id)).toBeVisible({ timeout: 20_000 })
      expect((await storedAnchor(page, id))?.tag).toEqual(tag)
      await zoomOutTo(page)
      const again = await bubbleCentre(page, id)
      const there = await clientPoint(page, 0, moved.x + tag.dx, moved.y + tag.dy)
      expect(Math.hypot(again.x - there.x, again.y - there.y)).toBeLessThan(4)

      // The cue's History says what happened.
      await page.getByRole('button', { name: 'Select', exact: true }).click()
      await tagBody(page, id).click()
      await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
      await page.getByRole('tab', { name: 'History', exact: true }).click()
      const history = page.getByRole('region', { name: 'History' })
      await expect(history.getByRole('list', { name: 'Changes' })).toContainText('Bubble moved', {
        timeout: 30_000,
      })
      await page.getByRole('tab', { name: 'Cue', exact: true }).click()

      // Reset to margin puts it back: the editor says so and the stored tag key is gone.
      await expect(bubbleRow).toContainText('Moved')
      await bubbleRow.getByRole('button', { name: 'Reset to margin' }).click()
      await expect.poll(async () => 'tag' in ((await storedAnchor(page, id)) ?? {})).toBe(false)
      const reset = (await storedAnchor(page, id)) as Anchor
      expect(reset).toEqual(placed)
      await expect(bubbleRow).toContainText('In the margin')
      await expect(bubbleRow.getByRole('button', { name: 'Reset to margin' })).toHaveCount(0)
      const back = await bubbleCentre(page, id)
      const lineY = (await clientPoint(page, 0, reset.x, reset.y)).y
      expect(Math.abs(back.y - lineY)).toBeLessThan(12)
      await uploaded(page)

      // The reset is in History too.
      await page.getByRole('tab', { name: 'History', exact: true }).click()
      await expect(history.getByRole('list', { name: 'Changes' })).toContainText(
        'Bubble back in the margin',
        { timeout: 30_000 },
      )
    } finally {
      await removeCue(page, id)
    }
  })
})

test('a moved bubble prints where it was put without its note, and back in the margin the tag and note print again', async ({
  browser,
}) => {
  test.skip(!hasPdftotext, 'pdftotext not installed')
  test.setTimeout(180_000)
  const work = mkdtempSync(join(tmpdir(), 'binder-bubble-e2e-'))
  try {
    await withUsers(browser, ['owner'], async ([a]) => {
      const { page } = a
      let id = ''
      try {
        const placedCue = await placeCueWithNote(page)
        id = placedCue.id
        const { width, height } = placedCue
        const placed = (await storedAnchor(page, id)) as Anchor
        await dragBubbleOntoText(page, id, placedCue)
        const moved = (await storedAnchor(page, id)) as Anchor
        const tag = moved.tag as { dx: number; dy: number }
        await uploaded(page)

        // Other cues on the shared show may have LX tags of their own: this cue's tag is told apart
        // by where it is. In the margin it is level with its line; moved, it is at the offset.
        const marginY = 1 - placed.y / height
        const inMargin = (w: PdfWord) => w.fx < 0.15 && Math.abs(w.fy - marginY) < 0.025

        // It prints where it was put, and the note is not drawn.
        const moves = join(work, 'moved.pdf')
        await exportPdf(page, moves)
        const tagWords = pdfWords(moves)
        const lx = tagWords.filter((w) => w.text === 'LX')
        const wantX = (moved.x + tag.dx) / width
        const wantY = 1 - (moved.y + tag.dy) / height
        const near = lx.filter(
          (w) => Math.abs(w.fx - wantX) < 0.06 && Math.abs(w.fy - wantY) < 0.03,
        )
        expect(near, `an LX tag near (${wantX.toFixed(3)}, ${wantY.toFixed(3)})`).toHaveLength(1)
        // no LX tag is left in the margin level with the cue's line, where its own tag would have been
        expect(lx.filter(inMargin)).toHaveLength(0)
        expect(tagWords.some((w) => w.text.startsWith('Zq'))).toBe(false)

        // Reset to margin: the print puts the margin tag and the note back.
        await cueEditor(page)
          .getByRole('group', { name: 'Bubble' })
          .getByRole('button', { name: 'Reset to margin' })
          .click()
        await expect.poll(async () => 'tag' in ((await storedAnchor(page, id)) ?? {})).toBe(false)
        await uploaded(page)
        const margin = join(work, 'margin.pdf')
        await exportPdf(page, margin)
        const words2 = pdfWords(margin)
        // the control: back in the margin, the tag is level with its line and the note is printed again
        expect(words2.filter((w) => w.text === 'LX').some(inMargin)).toBe(true)
        expect(words2.some((w) => w.text.startsWith('Zq'))).toBe(true)
      } finally {
        await removeCue(page, id)
      }
    })
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
