import { randomUUID } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'
import { clientPoint, withUsers } from './markupHelpers'

/**
 * Row history, the activity feed, and "Revert this change", on the run's shared show and its short
 * libretto. The shared show collects rows from the other specs, so every test works on rows it made
 * itself (ids and labels it chose) and removes them at the end.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

const SYNC = { timeout: 20_000 }

async function query<T>(page: Page, sql: string, params: unknown[] = []): Promise<T[]> {
  return page.evaluate(
    async ({ sql, params }) => ((await window.__binder?.db.getAll(sql, params)) ?? []) as unknown[],
    { sql, params },
  ) as Promise<T[]>
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

async function cueLabel(page: Page, id: string): Promise<string | undefined> {
  return (await query<{ label: string }>(page, 'SELECT label FROM cues WHERE id = ?', [id]))[0]
    ?.label
}

async function annotationText(page: Page, id: string): Promise<string | undefined> {
  return (await query<{ text: string }>(page, 'SELECT text FROM annotations WHERE id = ?', [id]))[0]
    ?.text
}

/** Inserts a placed LX cue on page 1 into the page's local database, then waits for the upload. */
async function seedCue(page: Page, id: string, label: string) {
  const { sharedShow, departments, libretto } = readRun()
  await page.evaluate(
    async (c) => {
      const now = new Date().toISOString()
      const anchor = JSON.stringify({
        documentId: c.documentId,
        documentVersionId: c.versionId,
        pageIndex: 0,
        x: 300,
        y: 640,
        status: 'ok',
      })
      await window.__binder?.db.execute(
        `INSERT INTO cues (id, show_id, department_id, major, minor, label, anchor, type, notes,
                           colour, payload, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, 77, 0, ?, ?, 'go', '', NULL, '{}', ?, ?, NULL)`,
        [c.id, c.showId, c.departmentId, c.label, anchor, now, now],
      )
    },
    {
      id,
      label,
      showId: sharedShow.id,
      departmentId: departments.LX,
      documentId: libretto.documentId,
      versionId: libretto.versionId,
    },
  )
  await uploaded(page)
}

async function removeRows(page: Page, table: 'cues' | 'annotations', ids: string[]) {
  await page.evaluate(
    async ({ table, ids }) => {
      for (const id of ids)
        await window.__binder?.db.execute(`DELETE FROM ${table} WHERE id = ?`, [id])
    },
    { table, ids },
  )
  await uploaded(page)
}

const marker = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"]`)
/** The marker's tag: the control that is clicked and dragged. */
const markerBox = (page: Page, id: string) => marker(page, id).locator('.cue-tag-body')
const cueEditor = (page: Page) => page.getByRole('region', { name: 'Cue editor' })
const annotationEditor = (page: Page) => page.getByRole('region', { name: 'Annotation editor' })

/** Selects the cue's marker and opens the History disclosure under its editor. */
async function openCueHistory(page: Page, id: string) {
  await expect(marker(page, id)).toBeVisible(SYNC)
  await markerBox(page, id).click()
  await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
  const history = cueEditor(page).getByRole('region', { name: 'History' })
  await history.getByRole('button', { name: 'History', exact: true }).click()
  return history
}

const localClock = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

test("the activity feed shows A's batch summary and B's revert from row history restores the label for both", async ({
  browser,
}) => {
  const { users, sharedShow, departments } = readRun()
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const id = randomUUID()
    try {
      await seedCue(a.page, id, 'Fly out')
      await expect.poll(() => cueLabel(b.page, id), SYNC).toBe('Fly out')

      // A relabels the cue in the cue editor: one write, one batch.
      await expect(marker(a.page, id)).toBeVisible()
      await markerBox(a.page, id).click()
      await cueEditor(a.page).getByLabel('Label').fill('Fly in')
      await cueEditor(a.page).getByLabel('Label').press('Enter')
      await expect.poll(() => cueLabel(a.page, id)).toBe('Fly in')
      await uploaded(a.page)
      await expect.poll(() => cueLabel(b.page, id), SYNC).toBe('Fly in')

      // The feed reads the newest batch as "<label> <summary>, <HH:mm>" in local time.
      const feed = await a.context.newPage()
      await feed.goto(`/shows/${sharedShow.id}/activity`)
      await expect(feed.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible({
        timeout: 30_000,
      })
      const newest = await feed.evaluate(async (showId) => {
        const res = await fetch(`/api/shows/${showId}/activity?limit=1`)
        return (await res.json()) as { groups: Array<{ at: string; summary: string }> }
      }, sharedShow.id)
      expect(newest.groups[0]?.summary).toBe('relabelled 1 LX cue')
      const sentence = `${users.owner.name} relabelled 1 LX cue, ${localClock(newest.groups[0].at)}`
      const first = feed.locator('.activity-row').first()
      await expect(first).toHaveText(`${sentence}Revert`)
      await expect(first.getByRole('button', { name: 'Revert' })).toBeEnabled()

      // The filters become the route's parameters.
      const request = feed.waitForRequest(
        (r) =>
          r.url().includes('/activity?') &&
          r.url().includes(`layer=${encodeURIComponent(`department:${departments.LX}`)}`) &&
          r.url().includes('kind=human'),
      )
      await feed.getByLabel('Layer').selectOption({ label: 'LX' })
      await feed.getByLabel('Changes by').selectOption('human')
      await request
      await expect(feed.locator('.activity-row').first()).toContainText(sentence)

      // B opens the cue's history and sees A's change, then reverts it.
      const history = await openCueHistory(b.page, id)
      const entries = history.getByRole('list', { name: 'Changes' }).locator('> li')
      const change = entries.first()
      await expect(change).toContainText(users.owner.name)
      await expect(change).toContainText('Label "Fly out" → "Fly in"')
      await change.getByRole('button', { name: 'Revert this change' }).click()

      // The label is back for both, and the revert is its own entry, by B, that can be reverted too.
      await expect.poll(() => cueLabel(b.page, id), SYNC).toBe('Fly out')
      await expect.poll(() => cueLabel(a.page, id), SYNC).toBe('Fly out')
      // A server revert is not one of B's own edits: B's personal undo has nothing to undo.
      await expect(b.page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
      await expect(entries.first()).toContainText(users.lxEditor.name)
      await expect(entries.first()).toContainText('Label "Fly in" → "Fly out"')
      await expect(
        entries.first().getByRole('button', { name: 'Revert this change' }),
      ).toBeEnabled()

      // The feed shows B's revert as a batch of its own after a reload.
      await feed.reload()
      await expect(feed.locator('.activity-row').first()).toContainText(
        `${users.lxEditor.name} relabelled 1 LX cue`,
        { timeout: 30_000 },
      )
    } finally {
      await removeRows(a.page, 'cues', [id])
    }
  })
})

test('reverting a change that has been changed since asks first, and only a yes overwrites', async ({
  browser,
}) => {
  await withUsers(browser, ['owner', 'lxEditor'], async ([a, b]) => {
    const id = randomUUID()
    const relabel = async (label: string) => {
      await cueEditor(a.page).getByLabel('Label').fill(label)
      await cueEditor(a.page).getByLabel('Label').press('Enter')
      await expect.poll(() => cueLabel(a.page, id)).toBe(label)
      await uploaded(a.page)
    }
    try {
      await seedCue(a.page, id, 'Fly out')
      await expect(marker(a.page, id)).toBeVisible()
      await markerBox(a.page, id).click()
      await relabel('Fly in')
      await relabel('Fly home')
      await expect.poll(() => cueLabel(b.page, id), SYNC).toBe('Fly home')

      const history = await openCueHistory(b.page, id)
      const entries = history.getByRole('list', { name: 'Changes' }).locator('> li')
      const older = entries.filter({ hasText: 'Label "Fly out" → "Fly in"' })
      await expect(older).toHaveCount(1, SYNC)

      // The label has changed since: the server says so and B is asked.
      await older.getByRole('button', { name: 'Revert this change' }).click()
      const dialog = b.page.getByRole('dialog', { name: 'This has changed since. Revert anyway?' })
      await expect(dialog).toBeVisible()
      // Document keys do not reach the selection behind the dialog.
      await b.page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(marker(b.page, id)).toHaveAttribute('data-selected', 'true')
      await b.page.waitForTimeout(1_000)
      expect(await cueLabel(b.page, id)).toBe('Fly home')

      await older.getByRole('button', { name: 'Revert this change' }).click()
      await dialog.getByRole('button', { name: 'Revert anyway' }).click()
      await expect.poll(() => cueLabel(b.page, id), SYNC).toBe('Fly out')
      await expect.poll(() => cueLabel(a.page, id), SYNC).toBe('Fly out')
    } finally {
      await removeRows(a.page, 'cues', [id])
    }
  })
})

test('a viewer reads the history, but the revert buttons are disabled with the reason', async ({
  browser,
}) => {
  await withUsers(browser, ['owner', 'viewer'], async ([a, v]) => {
    const id = randomUUID()
    try {
      await seedCue(a.page, id, 'Standby')
      const history = await openCueHistory(v.page, id)
      const entry = history.getByRole('list', { name: 'Changes' }).locator('> li').first()
      await expect(entry).toContainText(/Placed on p\.1/, SYNC)
      await expect(entry.getByRole('button', { name: 'Revert this change' })).toBeDisabled()
      await expect(history.getByText("You can't edit LX cues.")).toBeVisible()
    } finally {
      await removeRows(a.page, 'cues', [id])
    }
  })
})

test("an annotation's History tab lists its text edit and reverts it", async ({ browser }) => {
  const { libretto } = readRun()
  await withUsers(browser, ['owner'], async ([a]) => {
    let id = ''
    try {
      await a.page.getByLabel('Active layer LX').check()
      const versionIds = async () =>
        (
          await query<{ id: string }>(
            a.page,
            `SELECT id FROM annotations WHERE json_extract(anchor, '$.documentVersionId') = ?`,
            [libretto.versionId],
          )
        ).map((r) => r.id)
      const before = await versionIds()
      await a.page.getByRole('button', { name: 'Note tool', exact: true }).click()
      const at = await clientPoint(a.page, 0, 380, 420)
      await a.page.mouse.click(at.x, at.y)
      await expect.poll(async () => (await versionIds()).length).toBe(before.length + 1)
      id = (await versionIds()).find((i) => !before.includes(i)) ?? ''
      const editor = annotationEditor(a.page)
      await expect(editor.getByLabel('Text')).toBeFocused()
      const placeholder = (await annotationText(a.page, id)) ?? ''
      // The placement reaches the server before the text edit does, so each is its own entry.
      await uploaded(a.page)

      await a.page.keyboard.type('Bring up house lights')
      await a.page.keyboard.press('Tab')
      await expect.poll(() => annotationText(a.page, id)).toBe('Bring up house lights')
      await uploaded(a.page)

      const history = editor.getByRole('region', { name: 'History' })
      await history.getByRole('button', { name: 'History', exact: true }).click()
      const entries = history.getByRole('list', { name: 'Changes' }).locator('> li')
      await expect(entries.first()).toContainText('Text edited', SYNC)
      await expect(entries.last()).toContainText('Placed on p.1')

      await entries.first().getByRole('button', { name: 'Revert this change' }).click()
      await expect.poll(() => annotationText(a.page, id), SYNC).toBe(placeholder)
      // The revert is logged as a new edit on top.
      await expect(entries).toHaveCount(3)
      await expect(entries.first()).toContainText('Text edited')
    } finally {
      if (id) await removeRows(a.page, 'annotations', [id])
    }
  })
})

test('offline, the History tab says it needs a connection and undo still works', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const id = randomUUID()
    try {
      await seedCue(a.page, id, 'Blackout')
      const history = await openCueHistory(a.page, id)
      const list = history.getByRole('list', { name: 'Changes' })
      await expect(list.locator('> li').first()).toContainText('Placed on p.1', SYNC)

      await a.context.setOffline(true)
      await expect(a.page.getByLabel('Sync status')).toContainText('Offline')
      await expect(history.getByText('History needs a connection.')).toBeVisible()
      await expect(list).toHaveCount(0)

      // Personal undo is a local write: it works with no connection.
      await cueEditor(a.page).getByLabel('Label').fill('Blackout late')
      await cueEditor(a.page).getByLabel('Label').press('Enter')
      await expect.poll(() => cueLabel(a.page, id)).toBe('Blackout late')
      await a.page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect.poll(() => cueLabel(a.page, id)).toBe('Blackout')
      await expect(history.getByText('History needs a connection.')).toBeVisible()

      await a.context.setOffline(false)
      await expect(history.getByText('History needs a connection.')).toBeHidden()
      await expect(history.getByRole('list', { name: 'Changes' })).toBeVisible(SYNC)
    } finally {
      await a.context.setOffline(false)
      await removeRows(a.page, 'cues', [id])
    }
  })
})

test('the activity feed loads older groups with nextBefore as its end scrolls into view', async ({
  browser,
}) => {
  const { users, sharedShow } = readRun()
  const context = await browser.newContext({
    storageState: storageStateFor('owner'),
  })
  try {
    const page = await context.newPage()
    const group = (seq: number) => ({
      batchId: `b${seq}`,
      userId: users.owner.id,
      label: users.owner.name,
      summary: `moved 1 LX cue`,
      at: new Date(2026, 2, 2, 9, seq % 60).toISOString(),
      fromSeq: seq,
      toSeq: seq,
      count: 1,
      via: 'sync',
      agent: null,
    })
    const first = Array.from({ length: 40 }, (_, i) => group(1000 - i))
    const second = [group(500), group(499)]
    const requested: string[] = []
    await page.route(`**/api/shows/${sharedShow.id}/activity*`, async (route) => {
      const url = new URL(route.request().url())
      requested.push(url.searchParams.get('before') ?? '')
      const body = url.searchParams.get('before')
        ? { groups: second, nextBefore: null }
        : { groups: first, nextBefore: 500 }
      await route.fulfill({ json: body })
    })
    await page.goto(`/shows/${sharedShow.id}/activity`)
    const rows = page.locator('.activity-row')
    await expect(rows).toHaveCount(40, { timeout: 30_000 })
    await expect(rows.first()).toContainText(`${users.owner.name} moved 1 LX cue, 09:`)
    // The end of the list is far below the fold: nothing more has been asked for.
    expect(requested).toEqual([''])

    await page.locator('.activity-end').scrollIntoViewIfNeeded()
    await expect(rows).toHaveCount(42)
    expect(requested).toEqual(['', '500'])
    await expect(rows.last()).toContainText(`${users.owner.name} moved 1 LX cue, 09:`)
  } finally {
    await context.close()
  }
})
