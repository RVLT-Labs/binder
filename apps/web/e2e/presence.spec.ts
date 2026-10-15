import { randomUUID } from 'node:crypto'
import { presenceColour } from '@binder/shared'
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { readRun, storageStateFor, type UserKey } from './env'
import { clientPoint } from './markupHelpers'

/**
 * Presence on the short libretto (three pages): A's place in the binder shows as an avatar on B's
 * thumbnail and page, a cue A selects gets an outline in A's colour on B's screen, a personal
 * layer is never announced, and A leaving takes the avatar away. Each test removes the cue and
 * note it made so the next starts clean.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

interface Opened {
  page: Page
  /** Every text frame this page sent over a WebSocket. */
  sent: string[]
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}

/** Signs in as `user` in its own browser context and opens `path`, recording the frames it sends. */
async function openAs(
  browser: Browser,
  user: UserKey,
  contexts: BrowserContext[],
  path: string,
): Promise<Opened> {
  const context = await browser.newContext({ storageState: storageStateFor(user) })
  contexts.push(context)
  const page = await context.newPage()
  const sent: string[] = []
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => sent.push(String(frame.payload)))
  })
  await page.goto(path)
  return { page, sent }
}

const libretto = (query = '') => {
  const run = readRun()
  return `/shows/${run.sharedShow.id}/docs/${run.libretto.documentId}${query}`
}

/** Waits for the viewer to show `page` of 3 (one-based). */
async function atPage(page: Page, n: number) {
  await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText(`${n} / 3`, {
    timeout: 30_000,
  })
  await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })
}

const query = <T>(page: Page, sql: string, params: unknown[]) =>
  page.evaluate(
    async ({ sql, params }) => ((await window.__binder?.db.getAll(sql, params)) ?? []) as unknown[],
    { sql, params },
  ) as Promise<T[]>

/** Inserts an LX cue on page 3 (index 2) of the libretto into the page's local database. */
async function insertCue(page: Page, id: string) {
  const { sharedShow, departments, libretto: doc } = readRun()
  await page.evaluate(
    async (c) => {
      const now = new Date().toISOString()
      const anchor = JSON.stringify({
        documentId: c.documentId,
        documentVersionId: c.versionId,
        pageIndex: 2,
        x: 200,
        y: 500,
        status: 'ok',
      })
      await window.__binder?.db.execute(
        `INSERT INTO cues (id, show_id, department_id, major, minor, label, anchor, type, notes,
                           colour, payload, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, 77, 0, 'Presence', ?, 'go', '', NULL, '{}', ?, ?, NULL)`,
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
}

/** Deletes rows through a device, then waits until the upload queue has carried the deletes. */
async function remove(page: Page, table: 'cues' | 'annotations', ids: string[]) {
  await page.evaluate(
    async ({ table, ids }) => {
      for (const id of ids)
        await window.__binder?.db.execute(`DELETE FROM ${table} WHERE id = ?`, [id])
    },
    { table, ids },
  )
  await expect
    .poll(
      () =>
        page.evaluate(async () => (await window.__binder?.db.getUploadQueueStats())?.count ?? 0),
      { timeout: 20_000 },
    )
    .toBe(0)
}

const cueMarker = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"]`)
const thumbSlot = (page: Page, n: number) =>
  page
    .getByRole('navigation', { name: 'Thumbnails' })
    .locator('.thumbnail-slot')
    .nth(n - 1)
const outlines = (page: Page, pageIndex: number) =>
  page.locator(`[data-page-index="${pageIndex}"] .peer-outline rect`)

/** The ids of rows A selected that went out in presence frames. */
const selectedInFrames = (sent: string[]) =>
  sent
    .map((f) => {
      try {
        return (JSON.parse(f) as { state?: { selection?: { id: string } | null } }).state?.selection
          ?.id
      } catch {
        return undefined
      }
    })
    .filter((id): id is string => Boolean(id))

async function withBoth(
  browser: Browser,
  body: (a: Opened, b: Opened, contexts: BrowserContext[]) => Promise<void>,
  opts: { aPath?: string; bPath?: string } = {},
) {
  const contexts: BrowserContext[] = []
  try {
    const b = await openAs(browser, 'sndEditor', contexts, opts.bPath ?? libretto())
    if (!opts.bPath) await atPage(b.page, 1)
    const a = await openAs(browser, 'owner', contexts, opts.aPath ?? libretto('?p=3'))
    await body(a, b, contexts)
  } finally {
    for (const context of contexts) await context.close()
  }
}

test("B sees A's avatar on page 3's thumbnail within 3s and an outline on the cue A selects", async ({
  browser,
}) => {
  const { users, departments } = readRun()
  const owner = users.owner
  const colour = presenceColour(owner.id)
  await withBoth(browser, async (a, b) => {
    const cueId = randomUUID()
    try {
      await atPage(a.page, 3)

      // A's avatar is on page 3's thumbnail, in A's colour, named for a screen reader. Not page 1's.
      const avatar = thumbSlot(b.page, 3).getByRole('img', { name: `${owner.name} on page 3` })
      await expect(avatar).toBeVisible({ timeout: 3_000 })
      await expect(avatar).toHaveCSS('background-color', rgb(colour))
      await expect(
        thumbSlot(b.page, 3).getByRole('group', { name: 'People on page 3' }),
      ).toBeVisible()
      await expect(thumbSlot(b.page, 1).getByRole('img', { name: /on page/ })).toHaveCount(0)
      // The avatar never takes a click from the thumbnail under it.
      await expect(thumbSlot(b.page, 3).locator('.thumbnail-presence')).toHaveCSS(
        'pointer-events',
        'none',
      )

      // B opens page 3: A's avatar is at the page's top right too.
      await b.page
        .getByRole('navigation', { name: 'Thumbnails' })
        .getByRole('button', { name: 'Page 3' })
        .click()
      await atPage(b.page, 3)
      const pageGroup = b.page
        .locator('[data-page-index="2"]')
        .getByRole('group', { name: 'People on page 3' })
      await expect(pageGroup.getByRole('img', { name: `${owner.name} on page 3` })).toBeVisible()

      // A selects a cue on page 3.
      await insertCue(a.page, cueId)
      const aMarker = cueMarker(a.page, cueId)
      await expect(aMarker).toBeVisible({ timeout: 10_000 })
      await aMarker.click()
      await expect(aMarker).toHaveAttribute('data-selected', 'true')

      // B draws a 2 pt outline in A's colour, outside the marker, which keeps its department colour.
      const bMarker = cueMarker(b.page, cueId)
      await expect(bMarker).toBeVisible({ timeout: 10_000 })
      const outline = outlines(b.page, 2)
      await expect(outline).toHaveCount(1, { timeout: 3_000 })
      await expect(outline).toHaveAttribute('stroke', colour)
      await expect(outline).toHaveAttribute('stroke-width', '2')
      await expect(outline).toHaveAttribute('data-peer-id', owner.id)
      const group = b.page.locator('[data-page-index="2"] .peer-outline')
      await expect(group).toHaveAttribute('aria-hidden', 'true')
      await expect(outline).toHaveAttribute('pointer-events', 'none')
      const [markerBox, outlineBox] = await Promise.all([
        bMarker.locator('rect.cue-tag-body').boundingBox(),
        outline.boundingBox(),
      ])
      expect(outlineBox?.x ?? 0).toBeLessThan((markerBox?.x ?? 0) - 1)
      expect(outlineBox?.y ?? 0).toBeLessThan((markerBox?.y ?? 0) - 1)
      expect((outlineBox?.width ?? 0) - (markerBox?.width ?? 0)).toBeGreaterThan(4)
      const [deptColour] = await query<{ colour: string }>(
        b.page,
        'SELECT colour FROM departments WHERE id = ?',
        [departments.LX],
      )
      // The tag keeps its department colour: on its outline.
      await expect(bMarker.locator('rect.cue-tag-body')).toHaveAttribute(
        'stroke',
        deptColour.colour,
      )
      expect(deptColour.colour.toLowerCase()).not.toBe(colour)
      // Not focusable, and the marker under it is still B's to click.
      await expect(group.locator('[tabindex]')).toHaveCount(0)
      await bMarker.click()
      await expect(bMarker).toHaveAttribute('data-selected', 'true')

      // The row went out in A's frames; clearing A's selection removes the outline.
      expect(selectedInFrames(a.sent)).toContain(cueId)
      const blank = await clientPoint(a.page, 2, 400, 150)
      await a.page.mouse.click(blank.x, blank.y)
      await expect(aMarker).not.toHaveAttribute('data-selected', 'true')
      await expect(outline).toHaveCount(0, { timeout: 3_000 })
    } finally {
      await remove(a.page, 'cues', [cueId])
    }
  })
})

test("a personal note A selects is never announced: B sees no outline and A's frames name no note", async ({
  browser,
}) => {
  await withBoth(
    browser,
    async (a, b) => {
      const cueId = randomUUID()
      let noteId = ''
      try {
        await atPage(a.page, 1)
        await atPage(b.page, 1)
        await insertCue(a.page, cueId)
        const aMarker = cueMarker(a.page, cueId)
        await a.page
          .getByRole('navigation', { name: 'Thumbnails' })
          .getByRole('button', { name: 'Page 3' })
          .click()
        await expect(aMarker).toBeVisible({ timeout: 10_000 })
        await b.page
          .getByRole('navigation', { name: 'Thumbnails' })
          .getByRole('button', { name: 'Page 3' })
          .click()
        await expect(cueMarker(b.page, cueId)).toBeVisible({ timeout: 10_000 })

        // Control: a department cue A selects is outlined on B, so presence is working.
        await aMarker.click()
        await expect(outlines(b.page, 2)).toHaveCount(1, { timeout: 3_000 })

        // A draws a personal note, which selects it: B's outline goes and no outline appears.
        await a.page.getByLabel('Active layer Personal').check()
        await a.page.getByRole('button', { name: 'Note tool', exact: true }).click()
        const before = (await query<{ id: string }>(a.page, 'SELECT id FROM annotations', [])).map(
          (r) => r.id,
        )
        const p = await clientPoint(a.page, 2, 300, 650)
        await a.page.mouse.click(p.x, p.y)
        await expect
          .poll(async () => {
            const rows = await query<{ id: string }>(a.page, 'SELECT id FROM annotations', [])
            return rows.filter((r) => !before.includes(r.id)).length
          })
          .toBe(1)
        noteId =
          (await query<{ id: string }>(a.page, 'SELECT id FROM annotations', [])).find(
            (r) => !before.includes(r.id),
          )?.id ?? ''
        const note = a.page.locator(`[data-annotation-id="${noteId}"]`)
        await expect(note).toHaveAttribute('data-selected', 'true')
        await expect(outlines(b.page, 2)).toHaveCount(0, { timeout: 3_000 })

        // Wait out several throttle windows and heartbeats' worth of time: still nothing for B,
        // and nothing about the note in anything A sent.
        // A negative assertion needs real time to be meaningful: two seconds is eight of the
        // client's 250 ms send windows, so any selection frame would have reached B by now.
        await b.page.waitForTimeout(2_000)
        await expect(outlines(b.page, 2)).toHaveCount(0)
        expect(a.sent.some((f) => f.includes(noteId))).toBe(false)
        expect(selectedInFrames(a.sent)).not.toContain(noteId)
        expect(selectedInFrames(a.sent)).toContain(cueId)
      } finally {
        if (noteId) await remove(a.page, 'annotations', [noteId])
        await remove(a.page, 'cues', [cueId])
      }
    },
    { aPath: libretto(), bPath: libretto() },
  )
})

test("when A closes the tab, A's avatar is gone from B within 20s", async ({ browser }) => {
  const { users } = readRun()
  await withBoth(browser, async (a, b) => {
    await atPage(a.page, 3)
    const avatar = thumbSlot(b.page, 3).getByRole('img', { name: `${users.owner.name} on page 3` })
    await expect(avatar).toBeVisible({ timeout: 3_000 })

    await a.page.close()
    await expect(avatar).toHaveCount(0, { timeout: 20_000 })
    await expect(b.page.getByRole('img', { name: /on page/ })).toHaveCount(0)
  })
})

test('the show page lists who is in the binder: in the show, then the document and page', async ({
  browser,
}) => {
  const { users, sharedShow, libretto: doc } = readRun()
  const showPath = `/shows/${sharedShow.id}`
  await withBoth(
    browser,
    async (a, b) => {
      const list = b.page.getByRole('region', { name: 'Who is in the binder' })
      const entry = list.getByRole('listitem').filter({ hasText: users.owner.name })
      // The row starts with the avatar's initials, which are decorative; the sentence follows.
      const inShow = new RegExp(`${users.owner.name} — in the show$`)

      // A is in the show but has not opened a document: listed, and on no page.
      await expect(entry).toHaveText(inShow, { timeout: 5_000 })

      // A opens page 2 of the libretto.
      const [{ title }] = await query<{ title: string }>(
        b.page,
        'SELECT title FROM documents WHERE id = ?',
        [doc.documentId],
      )
      await a.page.goto(libretto('?p=2'))
      await atPage(a.page, 2)
      await expect(entry).toHaveText(new RegExp(`${users.owner.name} — ${title}, page 2$`), {
        timeout: 3_000,
      })
      await expect(entry).toHaveCount(1)

      // A goes back to the show page: no longer on a page.
      await a.page.goto(showPath)
      await expect(entry).toHaveText(inShow, { timeout: 5_000 })
    },
    { aPath: showPath, bPath: showPath },
  )
})
