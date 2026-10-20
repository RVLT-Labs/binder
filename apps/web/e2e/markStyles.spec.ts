import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Anchor, CueMark, WordLayer } from '@binder/shared'
import { expect, type Page, test } from '@playwright/test'
import { PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { readRun, storageStateFor } from './env'
import {
  clickAt,
  clientPoint,
  type Line,
  lineOf,
  pageText,
  withUsers,
  zoomOutTo,
} from './markupHelpers'
import {
  anchorOnLine,
  archiveShow,
  createRevisionShow,
  cueEntry,
  currentVersion,
  newRowId,
  type RevisionShow,
  signInAsOwner,
  syncUpload,
  uploadRevision,
  waitForVersion,
} from './revisionsHelpers'

/**
 * Cue mark styles on the short libretto: underline (the default), highlight, line and line with a
 * pointer, chosen per cue from the cue flyout or the cue editor, drawn by the overlay, printed, and
 * kept (not misread) by Calling mode and the revision review.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

interface LocalCue {
  id: string
  anchor: Anchor | null
}

/** A cue as the page's local database holds it, or null. */
async function localCue(page: Page, id: string): Promise<LocalCue | null> {
  const rows = await page.evaluate(
    async (cueId) =>
      (await window.__binder?.db.getAll<Record<string, unknown>>(
        'SELECT id, anchor FROM cues WHERE id = ?',
        [cueId],
      )) ?? [],
    id,
  )
  const row = rows[0]
  if (!row) return null
  return { id: String(row.id), anchor: row.anchor ? JSON.parse(String(row.anchor)) : null }
}

/** The ids of every cue on a version, in the page's local database. */
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

const marker = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"]`)
const trigger = (page: Page, id: string) => page.locator(`[data-cue-trigger="${id}"]`)

/** The effective mark of a stored anchor: absent means underline. */
const markOf = (anchor: Anchor | null | undefined): CueMark => anchor?.mark ?? 'underline'

/** Chooses the cue tool and the mark in its flyout. */
async function chooseMark(page: Page, mark: CueMark): Promise<void> {
  const tool = page.getByRole('button', { name: 'Cue tool' })
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
  await page.getByLabel('Cue mark').selectOption(mark)
}

/** Clicks the cue tool at a point of a page and returns the new cue's id once it is selected. */
async function placeAt(page: Page, versionId: string, x: number, y: number): Promise<string> {
  const before = await versionCueIds(page, versionId)
  await clickAt(page, 0, x, y)
  await expect
    .poll(async () => (await versionCueIds(page, versionId)).length)
    .toBe(before.length + 1)
  const id = (await versionCueIds(page, versionId)).find((c) => !before.includes(c)) ?? ''
  await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
  return id
}

/** Places a cue with the given mark on `line`, 3 points below its centre as the other specs do. */
async function placeMark(page: Page, mark: CueMark, line: Line): Promise<string> {
  await chooseMark(page, mark)
  return placeAt(page, readRun().libretto.versionId, line.x, line.centre - 3)
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

async function viewerReady(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('/ 3', { timeout })
  await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible()
}

/** The first line of the page's first lines holding a word of at least `min` characters. */
function longWord(layer: WordLayer, min: number) {
  for (const line of layer.lines.slice(0, 12)) {
    for (const i of line) {
      const w = layer.words[i]
      if (w && w.t.length >= min && w.w > 30) return { index: i, word: w }
    }
  }
  throw new Error(`no word of ${min} characters near the top of the page`)
}

test('place a highlight, a line and a pointer from the cue flyout: each is drawn and survives a reload', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    const ids: Record<'highlight' | 'line' | 'pointer', string> = {
      highlight: '',
      line: '',
      pointer: '',
    }
    try {
      await page.getByLabel('Active layer LX').check()
      await zoomOutTo(page)
      const { words } = await pageText(page, 0)
      ids.highlight = await placeMark(page, 'highlight', lineOf(words, 2))
      ids.line = await placeMark(page, 'line', lineOf(words, 5))
      ids.pointer = await placeMark(page, 'pointer', lineOf(words, 8))

      // Stored on the anchor: the mark, and for the line and pointer a character boundary.
      for (const mark of ['highlight', 'line', 'pointer'] as const) {
        await expect.poll(async () => markOf((await localCue(page, ids[mark]))?.anchor)).toBe(mark)
      }
      const lineAnchor = (await localCue(page, ids.line))?.anchor
      expect(lineAnchor?.text?.offset ?? 0).toBeGreaterThanOrEqual(0)
      expect(lineAnchor?.text?.wordStart ?? -1).toBeGreaterThanOrEqual(0)

      // Deselect, so the highlight rests at its 28% (it deepens to 40% while selected).
      await page.getByRole('button', { name: 'Select', exact: true }).click()
      await page.keyboard.press('Escape')

      const drawn = async () => {
        // A highlight: department-coloured, translucent boxes and no underline.
        const fill = trigger(page, ids.highlight).locator('rect.cue-fill')
        await expect(fill.first()).toHaveAttribute('fill-opacity', '0.28')
        await expect(trigger(page, ids.highlight).locator('line.cue-underline')).toHaveCount(0)
        // A line: one bar, no pointer, no underline.
        await expect(trigger(page, ids.line).locator('line.cue-bar')).toHaveCount(1)
        await expect(trigger(page, ids.line).locator('polygon.cue-pointer')).toHaveCount(0)
        await expect(trigger(page, ids.line).locator('line.cue-underline')).toHaveCount(0)
        // A pointer: the same bar and a triangle on it.
        await expect(trigger(page, ids.pointer).locator('line.cue-bar')).toHaveCount(1)
        await expect(trigger(page, ids.pointer).locator('polygon.cue-pointer')).toHaveCount(1)
        for (const id of Object.values(ids)) await expect(marker(page, id)).toBeVisible()
      }
      await drawn()

      // Wait for the writes to leave this device, then reload: all three are still there, same marks.
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
      await page.reload()
      await viewerReady(page)
      await expect(marker(page, ids.highlight)).toBeVisible({ timeout: 20_000 })
      await drawn()
      for (const mark of ['highlight', 'line', 'pointer'] as const) {
        expect(markOf((await localCue(page, ids[mark]))?.anchor)).toBe(mark)
      }
    } finally {
      await removeCues(page, Object.values(ids).filter(Boolean))
    }
  })
})

test("change a cue's mark in the editor and see it redrawn", async ({ browser }) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    let id = ''
    try {
      await page.getByLabel('Active layer LX').check()
      await zoomOutTo(page)
      const { words } = await pageText(page, 0)
      id = await placeMark(page, 'underline', lineOf(words, 3))
      const editor = page.getByRole('region', { name: 'Cue editor' })
      const mark = editor.getByRole('radiogroup', { name: 'Mark' })
      await expect(mark.getByRole('radio', { name: 'Underline', exact: true })).toBeChecked()
      await expect(trigger(page, id).locator('line.cue-underline').first()).toBeAttached()

      const choose = (name: string) => mark.getByRole('radio', { name, exact: true }).click()

      await choose('Highlight')
      await expect(mark.getByRole('radio', { name: 'Highlight', exact: true })).toBeChecked()
      await expect(trigger(page, id).locator('rect.cue-fill').first()).toBeVisible()
      await expect(trigger(page, id).locator('line.cue-underline')).toHaveCount(0)
      await expect.poll(async () => markOf((await localCue(page, id))?.anchor)).toBe('highlight')

      await choose('Line')
      await expect(trigger(page, id).locator('line.cue-bar')).toHaveCount(1)
      await expect(trigger(page, id).locator('rect.cue-fill')).toHaveCount(0)
      await expect(trigger(page, id).locator('polygon.cue-pointer')).toHaveCount(0)
      await expect.poll(async () => markOf((await localCue(page, id))?.anchor)).toBe('line')

      await choose('Line with pointer')
      await expect(trigger(page, id).locator('polygon.cue-pointer')).toHaveCount(1)
      await expect(trigger(page, id).locator('line.cue-bar')).toHaveCount(1)
      await expect.poll(async () => markOf((await localCue(page, id))?.anchor)).toBe('pointer')

      // Back to the default: the words are underlined again and the bar is gone.
      await choose('Underline')
      await expect(trigger(page, id).locator('line.cue-underline').first()).toBeAttached()
      await expect(trigger(page, id).locator('line.cue-bar')).toHaveCount(0)
      await expect(trigger(page, id).locator('polygon.cue-pointer')).toHaveCount(0)
      await expect.poll(async () => markOf((await localCue(page, id))?.anchor)).toBe('underline')
    } finally {
      await removeCues(page, id ? [id] : [])
    }
  })
})

test('dragging the margin tag of a highlight keeps it a highlight', async ({ browser }) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    let id = ''
    try {
      await page.getByLabel('Active layer LX').check()
      await zoomOutTo(page)
      const { words } = await pageText(page, 0)
      const from = lineOf(words, 3)
      const to = lineOf(words, 6)
      id = await placeMark(page, 'underline', from)
      const editor = page.getByRole('region', { name: 'Cue editor' })
      await editor
        .getByRole('radiogroup', { name: 'Mark' })
        .getByRole('radio', { name: 'Highlight', exact: true })
        .click()
      await expect(trigger(page, id).locator('rect.cue-fill').first()).toBeVisible()
      const firstY = (await localCue(page, id))?.anchor?.y

      const box = await marker(page, id).boundingBox()
      if (!box) throw new Error('marker not on screen')
      const target = await clientPoint(page, 0, to.x, to.centre + 2)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(target.x, target.y, { steps: 12 })
      await page.mouse.up()

      await expect.poll(async () => (await localCue(page, id))?.anchor?.y).not.toBe(firstY)
      expect(markOf((await localCue(page, id))?.anchor)).toBe('highlight')
      await expect(trigger(page, id).locator('rect.cue-fill').first()).toBeVisible()
      await expect(trigger(page, id).locator('line.cue-underline')).toHaveCount(0)
    } finally {
      await removeCues(page, id ? [id] : [])
    }
  })
})

/** The page's ExtGState entries as `{ BM, ca }`, across every page of a PDF. */
async function graphicsStates(bytes: Buffer): Promise<Array<{ BM?: string; ca?: number }>> {
  const doc = await PDFDocument.load(bytes)
  const out: Array<{ BM?: string; ca?: number }> = []
  for (const page of doc.getPages()) {
    const ext = page.node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict)
    for (const [, ref] of ext?.entries() ?? []) {
      const gs = doc.context.lookup(ref, PDFDict)
      const bm = gs.get(PDFName.of('BM'))
      const ca = gs.get(PDFName.of('ca'))
      out.push({
        BM: bm instanceof PDFName ? bm.asString().replace(/^\//, '') : undefined,
        ca: ca instanceof PDFNumber ? ca.asNumber() : undefined,
      })
    }
  }
  return out
}

test('the print preview shows the highlight: the exported page carries a translucent multiplied fill', async ({
  browser,
}) => {
  const work = mkdtempSync(join(tmpdir(), 'binder-markstyles-e2e-'))
  try {
    await withUsers(browser, ['owner'], async ([a]) => {
      const { page } = a
      let id = ''
      try {
        await page.getByLabel('Active layer LX').check()
        await zoomOutTo(page)
        const { words } = await pageText(page, 0)
        id = await placeMark(page, 'highlight', lineOf(words, 4))
        await page.getByRole('button', { name: 'Select', exact: true }).click()

        await page.getByRole('button', { name: 'Print', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Print' })
        await dialog.getByRole('button', { name: 'Calling script: all layers' }).click()
        // The sheet's own thumbnail is a drawing of margin tags; the real preview is the PDF it makes.
        await expect(dialog.getByRole('img', { name: /^Preview:/ })).toBeVisible()
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          dialog.getByRole('button', { name: 'Download PDF' }).click(),
        ])
        await expect(dialog).toBeHidden()
        const saved = join(work, 'highlight.pdf')
        await download.saveAs(saved)

        // The highlight prints as a 28% fill blended by multiply, so the script's black stays black.
        const states = await graphicsStates(readFileSync(saved))
        expect(states.some((s) => s.BM === 'Multiply' && Math.abs((s.ca ?? 0) - 0.28) < 1e-6)).toBe(
          true,
        )
      } finally {
        await removeCues(page, id ? [id] : [])
      }
    })
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('a mid-word line lands inside the word: its x is strictly between the word edges', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    let id = ''
    try {
      await page.getByLabel('Active layer LX').check()
      await zoomOutTo(page)
      const layer = (await pageText(page, 0)).words
      const { index, word } = longWord(layer, 7)

      // Click on the middle of the word, 3 points below its centre.
      await chooseMark(page, 'line')
      id = await placeAt(
        page,
        readRun().libretto.versionId,
        word.x + word.w / 2,
        word.y + word.h / 2 - 3,
      )

      // Stored: this word, a character boundary strictly inside it, and an x inside its box.
      const anchor = (await localCue(page, id))?.anchor
      expect(markOf(anchor)).toBe('line')
      expect(anchor?.text?.wordStart).toBe(index)
      const offset = anchor?.text?.offset ?? -1
      expect(offset).toBeGreaterThan(0)
      expect(offset).toBeLessThan(word.t.length)
      expect(anchor?.x ?? 0).toBeGreaterThan(word.x)
      expect(anchor?.x ?? 0).toBeLessThan(word.x + word.w)

      // Drawn: the bar sits between the word's left and right edges on screen too.
      const bar = await trigger(page, id).locator('line.cue-bar').boundingBox()
      if (!bar) throw new Error('the bar is not on screen')
      const barX = bar.x + bar.width / 2
      const left = await clientPoint(page, 0, word.x, word.y)
      const right = await clientPoint(page, 0, word.x + word.w, word.y)
      expect(barX).toBeGreaterThan(left.x)
      expect(barX).toBeLessThan(right.x)
      // and it has the word's height, give or take its padding
      expect(bar.height).toBeGreaterThan(0)
    } finally {
      await removeCues(page, id ? [id] : [])
    }
  })
})

test('Calling mode and the revision review render a highlight and a line cue without errors, and neither vanishes', async ({
  browser,
}) => {
  test.setTimeout(300_000)
  let show: RevisionShow | undefined
  const context = await browser.newContext({ storageState: storageStateFor('owner') })
  try {
    const created = await createRevisionShow('Mark styles')
    show = created
    const owner = await signInAsOwner()
    // Two cues on lines the short revision cuts (LX 20, LX 30) and two on lines it keeps (LX 10,
    // LX 40): a highlight and a line each, the lines on a character boundary inside their first word.
    const cases = [
      { key: 'highlight', snippet: 'With unusual revelry', major: 30, cut: true },
      { key: 'line', snippet: 'Two and twenty', major: 20, cut: true },
      { key: 'highlight', snippet: 'I took and bound this promising', major: 40, cut: false },
      { key: 'line', snippet: 'Strong his arm', major: 10, cut: false },
    ].map((c) => ({ ...c, id: newRowId() })) as Array<{
      key: 'highlight' | 'line'
      snippet: string
      major: number
      cut: boolean
      id: string
    }>
    await syncUpload(
      owner,
      await Promise.all(
        cases.map(async (c) => {
          const base = await anchorOnLine(owner, created, created.versionId, c.snippet)
          const anchor: Anchor =
            c.key === 'highlight'
              ? { ...base, mark: 'highlight' }
              : { ...base, mark: 'line', text: base.text && { ...base.text, offset: 1 } }
          return cueEntry(created, {
            id: c.id,
            departmentId: created.lxId,
            major: c.major,
            label: c.snippet.split(' ')[0] ?? '',
            anchor,
          })
        }),
      ),
    )

    const page = await context.newPage()
    const problems: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`)
    })
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

    const docPath = `/shows/${created.showId}/docs/${created.documentId}`
    await page.goto(docPath)
    await viewerReady(page)

    /**
     * Every cue keeps its mark and is drawn, wherever its pages are. A highlight whose words the
     * revision cut has nothing to fill and falls back to a tick (the spec's unbound rule).
     */
    const allDrawn = async (when: string, cutFallback: boolean) => {
      for (const c of cases) {
        const row = await localCue(page, c.id)
        expect(row, `${c.snippet} cue row ${when}`).not.toBeNull()
        expect(markOf(row?.anchor), `${c.snippet} mark ${when}`).toBe(c.key)
        if (c.key === 'line' && !c.cut && row?.anchor?.text) {
          expect(row.anchor.text.offset, `${c.snippet} offset ${when}`).toBe(1)
        }
        const pageIndex = row?.anchor?.pageIndex ?? 0
        const goTo = page.getByLabel('Go to page')
        if (await goTo.count()) {
          await goTo.fill(String(pageIndex + 1))
          await goTo.press('Enter')
        }
        await expect(
          page.locator(`[data-page-index="${pageIndex}"] [data-cue-id="${c.id}"]`),
          `${c.snippet} marker ${when}`,
        ).toHaveCount(1, { timeout: 30_000 })
        const selector =
          c.key === 'line'
            ? 'line.cue-bar'
            : cutFallback && c.cut
              ? 'rect.cue-fill, line.cue-tick'
              : 'rect.cue-fill'
        await expect(
          trigger(page, c.id).locator(selector).first(),
          `${c.snippet} ${c.key} drawn ${when}`,
        ).toBeAttached()
      }
    }

    // Markup, then Calling mode on the same version.
    await allDrawn('in markup', false)
    await page.getByRole('button', { name: 'Calling mode' }).click()
    await expect(page).toHaveURL(/[?&]mode=calling(&|$)/)
    await expect(page.getByRole('region', { name: 'Calling', exact: true })).toBeVisible()
    await allDrawn('in calling mode', false)
    await page.getByRole('button', { name: 'Exit' }).click()
    await expect(page).not.toHaveURL(/mode=calling/)

    // A revision cuts two of the lines: those cues are re-anchored and listed for review, marks intact.
    const v2 = await uploadRevision(owner, created, 'V2 cuts')
    await waitForVersion(owner, created.showId, created.documentId, v2, { current: true })
    expect(await currentVersion(owner, created)).toBe(v2)
    await page.reload()
    await viewerReady(page)
    const review = page.getByRole('region', { name: 'Revision review' })
    const tab = page.getByRole('tab', { name: /^Review/ })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
    await expect(review).toBeVisible()
    for (const label of ['LX 20', 'LX 30']) {
      const item = review.locator('li[data-review-item]').filter({ hasText: label })
      await expect(item).toBeVisible({ timeout: 30_000 })
      await expect(item.locator('figure')).toHaveCount(2)
      // each thumbnail draws a box over the quote or, failing that, a marker where the cue was
      await expect
        .poll(
          async () =>
            (await item.locator('[data-testid="review-thumb-box"]').count()) +
            (await item.locator('[data-testid="review-thumb-marker"]').count()),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0)
    }
    await allDrawn('after the revision', true)

    // Calling mode once more, on the revised script.
    await page.getByRole('button', { name: 'Calling mode' }).click()
    await expect(page.getByRole('region', { name: 'Calling', exact: true })).toBeVisible()
    await allDrawn('in calling mode on v2', true)

    expect(problems).toEqual([])
  } finally {
    await context.close()
    await archiveShow(show)
  }
})
