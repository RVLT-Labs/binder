import type { Anchor, WordLayer } from '@binder/shared'
import { expect, type Page, test } from '@playwright/test'
import { readRun } from './env'
import { clientPoint, lineOf, pageText, withUsers } from './markupHelpers'

/**
 * Annotations on the short libretto: drawn with the viewer's tools into the local PowerSync
 * database, edited in the side panel or by dragging, and read on a second user's device. Each test
 * removes what it drew so the next starts on a clean page.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

interface LocalAnnotation {
  id: string
  layer_kind: string
  layer_id: string
  type: string
  text: string
  anchor: Anchor
  geometry: Record<string, number>
  style: { colour?: string; strokeWidth?: number; fontSize?: number }
}

async function query<T>(page: Page, sql: string, params: unknown[] = []): Promise<T[]> {
  return page.evaluate(
    async ({ sql, params }) => ((await window.__binder?.db.getAll(sql, params)) ?? []) as unknown[],
    { sql, params },
  ) as Promise<T[]>
}

/** An annotation as a page's local database holds it, or null. */
async function localAnnotation(page: Page, id: string): Promise<LocalAnnotation | null> {
  const [row] = await query<Record<string, string>>(
    page,
    'SELECT * FROM annotations WHERE id = ?',
    [id],
  )
  if (!row) return null
  return {
    ...(row as unknown as LocalAnnotation),
    anchor: JSON.parse(row.anchor),
    geometry: JSON.parse(row.geometry),
    style: JSON.parse(row.style),
  }
}

async function versionIds(page: Page): Promise<string[]> {
  const { libretto } = readRun()
  return (
    await query<{ id: string }>(
      page,
      `SELECT id FROM annotations WHERE json_extract(anchor, '$.documentVersionId') = ? ORDER BY id`,
      [libretto.versionId],
    )
  ).map((r) => r.id)
}

const shape = (page: Page, id: string) => page.locator(`[data-annotation-id="${id}"]`)

/** Runs `draw`, then resolves to the id of the one annotation it made (on the page's version). */
async function drawing(page: Page, draw: () => Promise<void>): Promise<string> {
  const before = await versionIds(page)
  await draw()
  await expect.poll(async () => (await versionIds(page)).length).toBe(before.length + 1)
  const id = (await versionIds(page)).find((i) => !before.includes(i)) ?? ''
  await expect(shape(page, id)).toHaveAttribute('data-selected', 'true')
  return id
}

async function dragPage(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pageIndex = 0,
) {
  const a = await clientPoint(page, pageIndex, from.x, from.y)
  const b = await clientPoint(page, pageIndex, to.x, to.y)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
}

async function pick(page: Page, tool: string) {
  const button = page.getByRole('button', { name: `${tool} tool`, exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function select(page: Page) {
  await page.getByRole('button', { name: 'Select', exact: true }).click()
}

/** Page points per CSS pixel on page 0. */
async function pointsPerPixel(page: Page): Promise<number> {
  const { width } = await pageText(page, 0)
  const box = await page.locator('[data-page-index="0"]').boundingBox()
  if (!box) throw new Error('page 0 not on screen')
  return width / box.width
}

/** Waits until everything a page wrote locally has been uploaded: its queue is empty. */
async function uploaded(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => (await window.__binder?.db.getUploadQueueStats())?.count ?? 0),
      { timeout: 20_000 },
    )
    .toBe(0)
}

/** Removes the test's annotations through a device that syncs the deletes before the test ends. */
async function clean(page: Page, ids: string[]) {
  await page.evaluate(async (list) => {
    for (const id of list) {
      await window.__binder?.db.execute('DELETE FROM annotations WHERE id = ?', [id])
    }
  }, ids)
  await uploaded(page)
}

/** Counts the PATCH entries a page uploads for one annotation while `body` runs. */
async function countPatches(page: Page, id: string, body: () => Promise<void>): Promise<number> {
  let patches = 0
  const onRequest = (req: import('@playwright/test').Request) => {
    if (!req.url().includes('/api/sync/upload')) return
    const entries = (
      req.postDataJSON() as { entries?: Array<{ op: string; id: string; table: string }> }
    ).entries
    for (const e of entries ?? [])
      if (e.table === 'annotations' && e.id === id && e.op === 'PATCH') patches++
  }
  page.on('request', onRequest)
  try {
    await body()
    // Give the upload queue time to carry whatever was written.
    await page.waitForTimeout(1500)
  } finally {
    page.off('request', onRequest)
  }
  return patches
}

test('dragging a selected rect moves it and B sees the new position', async ({ browser }) => {
  const { departments } = readRun()
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const made: string[] = []
    try {
      await a.page.getByLabel('Active layer LX').check()
      await pick(a.page, 'Rect')
      const id = await drawing(a.page, () =>
        dragPage(a.page, { x: 150, y: 520 }, { x: 260, y: 440 }),
      )
      made.push(id)
      const row = await localAnnotation(a.page, id)
      expect(row).toMatchObject({
        type: 'rect',
        layer_kind: 'department',
        layer_id: departments.LX,
      })
      expect(row?.anchor.status).toBe('ok')
      expect(row?.geometry.w).toBeCloseTo(110, 0)
      const startX = row?.anchor.x ?? 0
      const startY = row?.anchor.y ?? 0
      // B draws it on the LX layer too: every member sees every department layer.
      await expect(shape(b.page, id)).toBeVisible({ timeout: 10_000 })

      // Select it, then drag its body 50 CSS pixels to the right: one update, on release.
      await select(a.page)
      const centre = await clientPoint(a.page, 0, startX + 55, startY + 40)
      const perPx = await pointsPerPixel(a.page)
      const patches = await countPatches(a.page, id, async () => {
        await a.page.mouse.move(centre.x, centre.y)
        await a.page.mouse.down()
        await a.page.mouse.move(centre.x + 25, centre.y, { steps: 5 })
        await a.page.mouse.move(centre.x + 50, centre.y, { steps: 5 })
        // Mid-drag nothing has been written.
        expect((await localAnnotation(a.page, id))?.anchor.x).toBeCloseTo(startX, 6)
        await a.page.mouse.up()
        await expect
          .poll(async () => (await localAnnotation(a.page, id))?.anchor.x)
          .toBeCloseTo(startX + 50 * perPx, 3)
      })
      expect(patches).toBe(1)

      const moved = await localAnnotation(a.page, id)
      expect(moved?.anchor.y).toBeCloseTo(startY, 6)
      expect(moved?.anchor.status).toBe('ok')
      expect(moved?.geometry).toEqual(row?.geometry)
      await expect
        .poll(async () => (await localAnnotation(b.page, id))?.anchor.x, { timeout: 10_000 })
        .toBeCloseTo(startX + 50 * perPx, 3)
    } finally {
      await clean(a.page, made)
    }
  })
})

test('A draws a rect on LX and a personal note; B sees the rect and never the note', async ({
  browser,
}) => {
  const { users } = readRun()
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const made: string[] = []
    try {
      // The personal note first: if it were going to reach B it would arrive before the rect.
      await a.page.getByLabel('Active layer Personal').check()
      await pick(a.page, 'Note')
      const noteId = await drawing(a.page, async () => {
        const p = await clientPoint(a.page, 0, 300, 600)
        await a.page.mouse.click(p.x, p.y)
      })
      made.push(noteId)
      expect(await localAnnotation(a.page, noteId)).toMatchObject({
        type: 'note',
        layer_kind: 'personal',
        layer_id: users.owner.id,
      })
      await expect(
        a.page.getByRole('button', { name: /^Personal note: Note, page 1$/ }),
      ).toBeVisible()

      await a.page.getByLabel('Active layer LX').check()
      await pick(a.page, 'Rect')
      const rectId = await drawing(a.page, () =>
        dragPage(a.page, { x: 150, y: 300 }, { x: 250, y: 240 }),
      )
      made.push(rectId)

      await expect
        .poll(
          async () => query(b.page, 'SELECT count(*) AS n FROM annotations WHERE id = ?', [rectId]),
          { timeout: 10_000 },
        )
        .toEqual([{ n: 1 }])
      expect(
        await query(
          b.page,
          'SELECT count(*) AS n FROM annotations WHERE layer_kind = ? AND layer_id = ?',
          ['personal', users.owner.id],
        ),
      ).toEqual([{ n: 0 }])
      expect(
        await query(b.page, 'SELECT count(*) AS n FROM annotations WHERE id = ?', [noteId]),
      ).toEqual([{ n: 0 }])
      await expect(shape(b.page, rectId)).toBeVisible()
      await expect(b.page.getByRole('button', { name: /^Personal note/ })).toHaveCount(0)
      await expect(shape(b.page, noteId)).toHaveCount(0)
    } finally {
      await clean(a.page, made)
    }
  })
})

test("editing a note's text and colour shows for both users", async ({ browser }) => {
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const made: string[] = []
    try {
      await a.page.getByLabel('Active layer LX').check()
      await pick(a.page, 'Note')
      const id = await drawing(a.page, async () => {
        const p = await clientPoint(a.page, 0, 380, 420)
        await a.page.mouse.click(p.x, p.y)
      })
      made.push(id)

      // A new note's text is selected in its editor, ready to be typed over.
      const editor = a.page.getByRole('region', { name: 'Annotation editor' })
      const text = editor.getByLabel('Text')
      await expect(text).toBeFocused()
      await a.page.keyboard.type('Bring up house lights')
      await a.page.keyboard.press('Tab')
      await expect
        .poll(async () => (await localAnnotation(a.page, id))?.text)
        .toBe('Bring up house lights')

      await editor.getByLabel('Colour').fill('#cc0000')
      await expect
        .poll(async () => (await localAnnotation(a.page, id))?.style.colour)
        .toBe('#cc0000')

      const name = 'LX note: Bring up house lights, page 1'
      await expect(a.page.getByRole('button', { name })).toBeVisible()
      await expect(b.page.getByRole('button', { name })).toBeVisible({ timeout: 10_000 })
      await expect
        .poll(async () => (await localAnnotation(b.page, id))?.style.colour, { timeout: 10_000 })
        .toBe('#cc0000')
      await expect(shape(b.page, id).locator('rect.annotation-note')).toHaveAttribute(
        'stroke',
        '#cc0000',
      )

      // Escape in the field throws a draft away; the note keeps its text and stays selected.
      await text.focus()
      await a.page.keyboard.type(' (draft)')
      await a.page.keyboard.press('Escape')
      await expect(text).toHaveValue('Bring up house lights')
      await expect(shape(a.page, id)).toHaveAttribute('data-selected', 'true')
      expect((await localAnnotation(a.page, id))?.text).toBe('Bring up house lights')
    } finally {
      await clean(a.page, made)
    }
  })
})

test("resizing a rect by its corner and moving an arrow's end are saved", async ({ browser }) => {
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const made: string[] = []
    try {
      await a.page.getByLabel('Active layer LX').check()
      await pick(a.page, 'Rect')
      const rectId = await drawing(a.page, () =>
        dragPage(a.page, { x: 100, y: 200 }, { x: 200, y: 140 }),
      )
      made.push(rectId)
      const rect = await localAnnotation(a.page, rectId)
      const fixed = { x: rect?.anchor.x ?? 0, y: rect?.anchor.y ?? 0 }

      // Drag the south-east handle out and down; the north-west corner (the anchor's x) stays put.
      await select(a.page)
      const handle = await a.page.locator('[data-handle="se"]').boundingBox()
      if (!handle) throw new Error('no handle')
      const hx = handle.x + handle.width / 2
      const hy = handle.y + handle.height / 2
      const perPx = await pointsPerPixel(a.page)
      await a.page.mouse.move(hx, hy)
      await a.page.mouse.down()
      await a.page.mouse.move(hx + 20, hy + 15, { steps: 5 })
      await a.page.mouse.up()
      await expect
        .poll(async () => (await localAnnotation(a.page, rectId))?.geometry.w)
        .toBeCloseTo((rect?.geometry.w ?? 0) + 20 * perPx, 1)
      const resized = await localAnnotation(a.page, rectId)
      expect(resized?.anchor.x).toBeCloseTo(fixed.x, 6)
      // Growing downward lowers the bottom edge: the anchor's y falls by the same 15 pixels.
      expect(resized?.anchor.y).toBeCloseTo(fixed.y - 15 * perPx, 1)
      expect(resized?.geometry.h).toBeCloseTo((rect?.geometry.h ?? 0) + 15 * perPx, 1)
      await expect
        .poll(async () => (await localAnnotation(b.page, rectId))?.geometry, { timeout: 10_000 })
        .toEqual(resized?.geometry)

      // An arrow: drag its end handle; the start stays.
      await pick(a.page, 'Arrow')
      const arrowId = await drawing(a.page, () =>
        dragPage(a.page, { x: 100, y: 700 }, { x: 220, y: 700 }),
      )
      made.push(arrowId)
      const arrow = await localAnnotation(a.page, arrowId)
      expect(arrow?.geometry.dx).toBeCloseTo(120, 0)
      expect(Math.abs(arrow?.geometry.dy ?? 1)).toBeLessThan(0.01)
      await select(a.page)
      const end = await a.page.locator('[data-handle="end"]').boundingBox()
      if (!end) throw new Error('no end handle')
      const ex = end.x + end.width / 2
      const ey = end.y + end.height / 2
      await a.page.mouse.move(ex, ey)
      await a.page.mouse.down()
      await a.page.mouse.move(ex - 30, ey - 40, { steps: 5 })
      await a.page.mouse.up()
      await expect
        .poll(async () => (await localAnnotation(a.page, arrowId))?.geometry.dy)
        .toBeCloseTo(40 * perPx, 1)
      const moved = await localAnnotation(a.page, arrowId)
      expect(moved?.anchor.x).toBeCloseTo(arrow?.anchor.x ?? 0, 6)
      expect(moved?.anchor.y).toBeCloseTo(arrow?.anchor.y ?? 0, 6)
      expect(moved?.geometry.dx).toBeCloseTo((arrow?.geometry.dx ?? 0) - 30 * perPx, 1)
      await expect
        .poll(async () => (await localAnnotation(b.page, arrowId))?.geometry, { timeout: 10_000 })
        .toEqual(moved?.geometry)
    } finally {
      await clean(a.page, made)
    }
  })
})

/** The middle of a word, for aiming a drag at it. */
function centreOf(layer: WordLayer, index: number) {
  const w = layer.words[index]
  if (!w) throw new Error(`no word ${index}`)
  return { x: w.x + w.w / 2, y: w.y + w.h / 2 }
}

/** The lines (by index) that hold any word of the range. */
function linesCovering(layer: WordLayer, start: number, end: number): number {
  return layer.lines.filter((l) => l.some((i) => i >= start && i <= end)).length
}

test('dragging across words makes a highlight over exactly those words; "Re-select words" rebinds it', async ({
  browser,
}) => {
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const made: string[] = []
    try {
      const { words } = await pageText(a.page, 0)
      const lines = words.lines.filter((l) => l.length >= 3)
      // From the second word of one line to the third word of the next line but one.
      const first = lines[1]?.[1] ?? 0
      const last = lines[3]?.[2] ?? 0
      expect(first).toBeLessThan(last)

      await a.page.getByLabel('Active layer LX').check()
      await pick(a.page, 'Highlight')
      const id = await drawing(a.page, () =>
        dragPage(a.page, centreOf(words, first), centreOf(words, last)),
      )
      made.push(id)

      const row = await localAnnotation(a.page, id)
      const covered = Array.from({ length: last - first + 1 }, (_, i) => words.words[first + i]?.t)
      expect(row?.anchor.text).toEqual({
        quote: covered.slice(0, 8).join(' '),
        wordStart: first,
        wordEnd: last,
      })
      expect(row?.anchor.status).toBe('ok')
      expect(row?.anchor.x).toBeCloseTo(words.words[first]?.x ?? 0, 6)
      expect(row?.type).toBe('highlight')

      // One rectangle per covered line, on both devices.
      const rects = linesCovering(words, first, last)
      expect(rects).toBeGreaterThan(1)
      await expect(shape(a.page, id).locator('rect.annotation-highlight')).toHaveCount(rects)
      await expect(shape(b.page, id).locator('rect.annotation-highlight')).toHaveCount(rects, {
        timeout: 10_000,
      })

      // Re-select words: the next drag rebinds this highlight (same row) to a new range.
      const nextFirst = lines[5]?.[0] ?? 0
      const nextLast = lines[5]?.[2] ?? 0
      await a.page.getByRole('button', { name: 'Re-select words' }).click()
      await dragPage(a.page, centreOf(words, nextFirst), centreOf(words, nextLast))
      await expect
        .poll(async () => (await localAnnotation(a.page, id))?.anchor.text?.wordStart)
        .toBe(nextFirst)
      const rebound = await localAnnotation(a.page, id)
      expect(rebound?.anchor.text?.wordEnd).toBe(nextLast)
      expect(rebound?.anchor.status).toBe('ok')
      expect(rebound?.anchor.x).toBeCloseTo(words.words[nextFirst]?.x ?? 0, 6)
      expect(await versionIds(a.page)).toContain(id)
      await expect(shape(a.page, id).locator('rect.annotation-highlight')).toHaveCount(
        linesCovering(words, nextFirst, nextLast),
      )
      await expect(a.page.getByRole('button', { name: 'Re-select words' })).toBeVisible()
      await expect
        .poll(async () => (await localAnnotation(b.page, id))?.anchor.text, { timeout: 10_000 })
        .toEqual(rebound?.anchor.text)
    } finally {
      await clean(a.page, made)
    }
  })
})

test('a stamp from the show stamp set lands where clicked', async ({ browser }) => {
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const made: string[] = []
    try {
      await a.page.getByLabel('Active layer LX').check()
      await pick(a.page, 'Stamp')
      const toolbar = a.page.getByRole('toolbar', { name: 'Viewer' })
      const picker = toolbar.getByLabel('Stamp', { exact: true })
      await expect(picker.locator('option')).toHaveText([
        'Enter',
        'Exit',
        'Fly in',
        'Fly out',
        'Blackout',
        'Standby',
        'Go',
      ])
      await picker.selectOption('Fly in')
      const target = { x: 420, y: 560 }
      const id = await drawing(a.page, async () => {
        const p = await clientPoint(a.page, 0, target.x, target.y)
        await a.page.mouse.click(p.x, p.y)
      })
      made.push(id)
      const row = await localAnnotation(a.page, id)
      expect(row).toMatchObject({ type: 'stamp', text: 'Fly in', layer_kind: 'department' })
      const perPx = await pointsPerPixel(a.page)
      // Where it was clicked, to the pixel: the pointer lands on whole device pixels.
      expect(Math.abs((row?.anchor.x ?? 0) - target.x)).toBeLessThanOrEqual(perPx)
      expect(Math.abs((row?.anchor.y ?? 0) - target.y)).toBeLessThanOrEqual(perPx)
      await expect(b.page.getByRole('button', { name: 'LX stamp: Fly in, page 1' })).toBeVisible({
        timeout: 10_000,
      })

      // The editor changes it to another of the show's stamps.
      await a.page
        .getByRole('region', { name: 'Annotation editor' })
        .getByLabel('Stamp')
        .selectOption('Blackout')
      await expect.poll(async () => (await localAnnotation(a.page, id))?.text).toBe('Blackout')
      await expect(b.page.getByRole('button', { name: 'LX stamp: Blackout, page 1' })).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await clean(a.page, made)
    }
  })
})

test('an owner edit to the stamp set reaches another member’s stamp picker', async ({
  browser,
}) => {
  const { sharedShow } = readRun()
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const toolbarStamps = async (page: Page) => {
      await pick(page, 'Stamp')
      return page
        .getByRole('toolbar', { name: 'Viewer' })
        .getByLabel('Stamp', { exact: true })
        .locator('option')
    }
    const settings = await a.context.newPage()
    await settings.goto(`/shows/${sharedShow.id}/settings`)
    const list = settings.getByRole('list', { name: 'Stamps' })
    try {
      await expect(list.getByRole('listitem')).toHaveCount(7)
      await settings.getByLabel('New stamp name').fill('Hold')
      await settings.getByRole('button', { name: 'Add stamp' }).click()
      await expect(list.getByRole('listitem')).toHaveCount(8)

      // The owner's own viewer, then the lx editor's after the edit has synced.
      await expect(await toolbarStamps(a.page)).toHaveCount(8)
      await expect(await toolbarStamps(b.page)).toHaveCount(8, { timeout: 15_000 })
      await expect((await toolbarStamps(b.page)).last()).toHaveText('Hold')
    } finally {
      await settings.getByRole('button', { name: 'Remove Hold' }).click()
      await expect(list.getByRole('listitem')).toHaveCount(7)
      await uploaded(settings)
      await settings.close()
    }
    // A non-owner reads the list and cannot change it.
    const theirs = await b.context.newPage()
    await theirs.goto(`/shows/${sharedShow.id}/settings`)
    await expect(theirs.getByRole('list', { name: 'Stamps' }).getByRole('listitem')).toHaveCount(
      7,
      {
        timeout: 15_000,
      },
    )
    await expect(theirs.getByLabel('New stamp name')).toHaveCount(0)
    await expect(theirs.getByRole('button', { name: /^Remove / })).toHaveCount(0)
    await theirs.close()
  })
})

test('Delete removes the selected annotation for both users; a locked layer refuses the tools', async ({
  browser,
}) => {
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const made: string[] = []
    try {
      await a.page.getByLabel('Active layer LX').check()
      await pick(a.page, 'Ellipse')
      const id = await drawing(a.page, () =>
        dragPage(a.page, { x: 420, y: 250 }, { x: 500, y: 190 }),
      )
      made.push(id)
      await expect(shape(b.page, id)).toBeVisible({ timeout: 10_000 })
      await expect(a.page.locator('[role="status"].visually-hidden')).toContainText(
        /^Selected LX ellipse, page 1$/,
      )

      // Locked: the tools are disabled with the reason, and Delete does nothing.
      await a.page.getByLabel('Lock LX').check()
      const rect = a.page.getByRole('button', { name: 'Rect tool', exact: true })
      await expect(rect).toBeDisabled()
      await expect(rect).toHaveAccessibleDescription('The LX layer is locked.')
      await a.page.keyboard.press('Delete')
      await expect(a.page.getByRole('alert')).toHaveCount(0)
      expect(await localAnnotation(a.page, id)).not.toBeNull()
      await a.page.getByLabel('Lock LX').uncheck()
      await expect(rect).toBeEnabled()

      await shape(a.page, id).focus()
      await a.page.keyboard.press('Escape')
      await a.page.keyboard.press('Enter')
      await expect(shape(a.page, id)).toHaveAttribute('aria-pressed', 'true')
      await a.page.keyboard.press('Delete')
      await expect.poll(async () => localAnnotation(a.page, id)).toBeNull()
      await expect.poll(async () => localAnnotation(b.page, id), { timeout: 10_000 }).toBeNull()
      await expect(shape(a.page, id)).toHaveCount(0)
    } finally {
      await clean(a.page, made)
    }
  })
})

test('a viewer draws on their personal layer only, and a hidden layer disables the tools', async ({
  browser,
}) => {
  const { users } = readRun()
  await withUsers(browser, ['viewer'], async ([v]) => {
    const made: string[] = []
    try {
      await expect(v.page.getByLabel('Active layer Personal')).toBeChecked()
      await expect(v.page.getByLabel('Active layer LX')).toBeDisabled()
      await pick(v.page, 'Rect')
      const id = await drawing(v.page, () =>
        dragPage(v.page, { x: 150, y: 400 }, { x: 230, y: 340 }),
      )
      made.push(id)
      expect(await localAnnotation(v.page, id)).toMatchObject({
        layer_kind: 'personal',
        layer_id: users.viewer.id,
      })
      await expect(v.page.getByRole('button', { name: 'Personal rect, page 1' })).toBeVisible()

      await v.page.getByLabel('Show Personal').uncheck()
      const tool = v.page.getByRole('button', { name: 'Rect tool', exact: true })
      await expect(tool).toBeDisabled()
      await expect(tool).toHaveAccessibleDescription('Show the Personal layer to draw on it')
      await expect(shape(v.page, id)).toHaveCount(0)
      await v.page.getByLabel('Show Personal').check()
      await expect(shape(v.page, id)).toBeVisible()
    } finally {
      await clean(v.page, made)
    }
  })
})

/** A cue's label in a page's local database, or undefined when the cue is not there. */
async function cueLabel(page: Page, id: string): Promise<string | undefined> {
  const [row] = await query<{ label: string }>(page, 'SELECT label FROM cues WHERE id = ?', [id])
  return row?.label
}

test('undo restores a deleted cue; undo after B relabels the cue is blocked with a notice', async ({
  browser,
}) => {
  const { libretto } = readRun()
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    let id = ''
    try {
      await a.page.getByLabel('Active layer LX').check()
      const line = lineOf((await pageText(a.page, 0)).words, 5)
      const cueIds = async () =>
        (
          await query<{ id: string }>(
            a.page,
            `SELECT id FROM cues WHERE json_extract(anchor, '$.documentVersionId') = ?`,
            [libretto.versionId],
          )
        ).map((r) => r.id)
      const before = await cueIds()
      const at = await clientPoint(a.page, 0, line.x, line.centre + 2)
      await a.page.mouse.move(at.x, at.y)
      await a.page.keyboard.press('c')
      await expect.poll(async () => (await cueIds()).length).toBe(before.length + 1)
      id = (await cueIds()).find((c) => !before.includes(c)) ?? ''
      const marker = (page: Page) => page.locator(`[data-cue-id="${id}"]`)
      await expect(marker(a.page)).toHaveAttribute('data-selected', 'true')
      await expect(marker(b.page)).toBeVisible({ timeout: 10_000 })

      const undo = a.page.getByRole('button', { name: 'Undo', exact: true })
      const redo = a.page.getByRole('button', { name: 'Redo', exact: true })
      await expect(undo).toBeEnabled()
      await expect(redo).toBeDisabled()

      // Delete, then Undo brings the same cue (same id) back, here and on B.
      await a.page.keyboard.press('Delete')
      await expect(marker(a.page)).toHaveCount(0)
      await expect(marker(b.page)).toHaveCount(0, { timeout: 10_000 })
      await undo.click()
      await expect(marker(a.page)).toBeVisible()
      await expect(marker(b.page)).toBeVisible({ timeout: 10_000 })
      await expect(redo).toBeEnabled()

      // B (LX editor) relabels the cue.
      await marker(b.page).click()
      const editor = b.page.getByRole('region', { name: 'Cue editor' })
      await editor.getByLabel('Label').fill('Relabelled by B')
      await editor.getByLabel('Label').press('Enter')
      await expect.poll(() => cueLabel(a.page, id), { timeout: 10_000 }).toBe('Relabelled by B')

      // A's next undo (the placement) would remove B's work: blocked, with a notice, nothing lost.
      await a.page.locator('body').click({ position: { x: 5, y: 5 } })
      await a.page.keyboard.press('Control+z')
      await expect(a.page.getByRole('alert')).toContainText(
        "Can't undo: someone else has changed this since",
      )
      expect(await cueLabel(a.page, id)).toBe('Relabelled by B')
      await expect(marker(a.page)).toBeVisible()
      // The blocked entry left the stack.
      await expect(undo).toBeDisabled()

      // Redo the undone delete is still its own entry... which would now remove B's work: the
      // stack never reapplies over someone else's change.
      await redo.click()
      await expect(a.page.getByRole('alert').last()).toContainText("Can't redo")
      expect(await cueLabel(a.page, id)).toBe('Relabelled by B')
    } finally {
      if (id) {
        await a.page.evaluate(async (cueId) => {
          await window.__binder?.db.execute('DELETE FROM cues WHERE id = ?', [cueId])
        }, id)
        await uploaded(a.page)
      }
    }
  })
})
