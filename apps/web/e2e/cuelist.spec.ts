import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { FIXTURES } from '@binder/fixtures'
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'
import { API_URL, APP_URL, readRun, storageStateFor, type UserKey } from './env'

/**
 * Cue lists and "Renumber from script order". The specs share one fresh show of their own (made in
 * beforeAll, with its own copy of the short libretto) so the LX list holds only the cues each test
 * puts there, whatever the other specs left in the run's shared show.
 */
test.use({ viewport: { width: 1440, height: 1000 } })

interface Fixture {
  showId: string
  lxId: string
  documentId: string
  versionId: string
}
let show: Fixture

async function call<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`sign-in: ${res.status} ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function createFixture(): Promise<Fixture> {
  const { users, password } = readRun()
  const owner = await signIn(users.owner.email, password)
  const { organisations } = await call<{ organisations: { id: string }[] }>(
    owner,
    'GET',
    '/api/me/orgs',
  )
  const { show: created } = await call<{ show: { id: string } }>(
    owner,
    'POST',
    `/api/orgs/${organisations[0]?.id}/shows`,
    { title: `Cue lists ${Date.now()}` },
  )
  const { departments } = await call<{ departments: { id: string; code: string }[] }>(
    owner,
    'GET',
    `/api/shows/${created.id}/departments`,
  )
  const lxId = departments.find((d) => d.code === 'LX')?.id ?? ''
  const addMember = async (email: string, role: 'editor' | 'viewer', scope?: string[]) => {
    const { membership } = await call<{ membership: { id: string } }>(
      owner,
      'POST',
      `/api/shows/${created.id}/members`,
      { email, role },
    )
    if (scope) {
      await call(owner, 'PATCH', `/api/memberships/${membership.id}`, { departments: scope })
    }
  }
  await addMember(users.lxEditor.email, 'editor', [lxId])
  await addMember(users.viewer.email, 'viewer')

  const form = new FormData()
  form.append('kind', 'libretto')
  form.append('title', 'Cue list libretto')
  form.append(
    'file',
    new Blob([readFileSync(FIXTURES.librettoShortPdf)], { type: 'application/pdf' }),
    basename(FIXTURES.librettoShortPdf),
  )
  const res = await fetch(`${API_URL}/api/shows/${created.id}/documents`, {
    method: 'POST',
    headers: { cookie: owner, origin: APP_URL },
    body: form,
  })
  if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`)
  const { document, version } = (await res.json()) as {
    document: { id: string }
    version: { id: string }
  }
  const deadline = Date.now() + 150_000
  for (;;) {
    const { documents } = await call<{
      documents: { id: string; versions: { id: string; status: string }[] }[]
    }>(owner, 'GET', `/api/shows/${created.id}/documents`)
    const status = documents
      .find((d) => d.id === document.id)
      ?.versions.find((v) => v.id === version.id)?.status
    if (status === 'ready') break
    if (status === 'failed' || Date.now() > deadline) throw new Error(`libretto ${status}`)
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return { showId: created.id, lxId, documentId: document.id, versionId: version.id }
}

test.beforeAll(async () => {
  test.setTimeout(200_000)
  show = await createFixture()
})

/** Archives the spec's show, so the owner's list of active shows is what other specs expect. */
test.afterAll(async () => {
  if (!show) return
  const { users, password } = readRun()
  const owner = await signIn(users.owner.email, password)
  await call(owner, 'PATCH', `/api/shows/${show.showId}`, { status: 'archived' })
})

async function openList(
  browser: Browser,
  user: UserKey,
  contexts: BrowserContext[],
): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(user) })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(`/shows/${show.showId}/cues?department=${show.lxId}`)
  await expect(page.getByRole('heading', { name: 'LX cue list' })).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => window.__binder !== undefined)
  return page
}

/** Starts a test from an empty LX list: the show is this spec's own, so only its tests' cues go. */
async function clearCues(page: Page): Promise<void> {
  await page.evaluate(async (showId) => {
    await window.__binder?.db.execute('DELETE FROM cues WHERE show_id = ?', [showId])
  }, show.showId)
}

interface SeedCue {
  id: string
  major: number
  minor?: number
  label: string
  pageIndex: number | null
  y?: number
}

/** Inserts anchored LX cues into the page's local database in one transaction, as the markup tools do. */
function seed(page: Page, cues: SeedCue[]): Promise<void> {
  return page.evaluate(
    async ({ cues, fx }) => {
      const now = new Date().toISOString()
      await window.__binder?.db.writeTransaction(async (tx) => {
        for (const c of cues) {
          const anchor =
            c.pageIndex === null
              ? null
              : JSON.stringify({
                  documentId: fx.documentId,
                  documentVersionId: fx.versionId,
                  pageIndex: c.pageIndex,
                  x: 100,
                  y: c.y ?? 700,
                  status: 'ok',
                })
          await tx.execute(
            `INSERT INTO cues (id, show_id, department_id, major, minor, label, anchor, type, notes,
                               colour, payload, created_at, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'go', '', NULL, '{}', ?, ?, NULL)`,
            [c.id, fx.showId, fx.lxId, c.major, c.minor ?? 0, c.label, anchor, now, now],
          )
        }
      })
    },
    { cues, fx: show },
  )
}

/** `major.minor` per cue id, from the page's local database. */
function numbers(page: Page, ids: string[]): Promise<Record<string, string>> {
  return page.evaluate(async (ids) => {
    const out: Record<string, string> = {}
    for (const id of ids) {
      const rows =
        (await window.__binder?.db.getAll<{ major: number; minor: number }>(
          'SELECT major, minor FROM cues WHERE id = ?',
          [id],
        )) ?? []
      out[id] = rows[0] ? `${rows[0].major}.${rows[0].minor}` : 'gone'
    }
    return out
  }, ids)
}

const row = (page: Page, id: string): Locator => page.locator(`tr[data-cue-id="${id}"]`)
const numberField = (page: Page, id: string) => row(page, id).getByLabel(/^Number/)
const synced = (page: Page, timeout = 30_000) =>
  expect(page.getByLabel('Sync status')).toHaveText('Connected', { timeout })

test('the LX list shows a duplicate badge; renumbering from script order gives 10, 11, 12 in page order and clears it', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const page = await openList(browser, 'owner', contexts)
    await clearCues(page)
    const [a, b, c, free] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    await seed(page, [
      { id: c, major: 5, label: 'Third', pageIndex: 1, y: 700 },
      { id: a, major: 12, label: 'First', pageIndex: 0, y: 700 },
      { id: b, major: 12, label: 'Second', pageIndex: 0, y: 300 },
      { id: free, major: 99, label: 'Unplaced', pageIndex: null },
    ])
    await synced(page)

    // Sorted by number, with the unplaced cue trailing; the shared number is flagged on both cues.
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await expect(page.locator('tbody tr').first()).toHaveAttribute('data-cue-id', c)
    await expect(page.locator('.badge[data-flag="duplicate"]')).toHaveCount(2)
    await expect(row(page, a).getByText('Duplicate')).toBeVisible()
    await expect(row(page, c).getByText('Duplicate')).toHaveCount(0)
    await expect(row(page, free)).toContainText('—')

    await page.getByRole('button', { name: 'Renumber from script order' }).click()
    const dialog = page.getByRole('dialog', { name: /Renumber LX/ })
    await expect(dialog.getByLabel('Block size')).toHaveValue('10')
    await expect(dialog.getByRole('status')).toContainText('3 of 3 cues will change')
    await dialog.getByRole('button', { name: 'Apply renumbering' }).click()
    await expect(dialog).toBeHidden()

    expect(await numbers(page, [a, b, c, free])).toEqual({
      [a]: '10.0',
      [b]: '11.0',
      [c]: '12.0',
      [free]: '99.0',
    })
    await expect(page.locator('.badge[data-flag="duplicate"]')).toHaveCount(0)
    const order = await page
      .locator('tbody tr')
      .evaluateAll((rs) => rs.map((r) => r.getAttribute('data-cue-id')))
    expect(order).toEqual([a, b, c, free])
    await synced(page)
    expect(page.url()).toContain('/cues')
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('editing a number to "12.5" shows 12.5; "abc" shows an error and changes nothing', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const page = await openList(browser, 'owner', contexts)
    await clearCues(page)
    const id = randomUUID()
    await seed(page, [{ id, major: 40, label: 'Edit me', pageIndex: 2, y: 500 }])
    await expect(row(page, id)).toBeVisible()

    const field = numberField(page, id)
    await field.fill('12.5')
    await field.press('Enter')
    await expect(field).toHaveValue('12.5')
    expect((await numbers(page, [id]))[id]).toBe('12.50')
    await expect(page.getByRole('alert')).toHaveCount(0)

    await field.fill('abc')
    await field.press('Enter')
    await expect(row(page, id).getByRole('alert')).toContainText('Cue numbers look like')
    expect((await numbers(page, [id]))[id]).toBe('12.50')

    // Label and notes edit in place, and the type is a choice.
    await row(page, id)
      .getByLabel(/^Label/)
      .fill('Sunrise')
    await row(page, id)
      .getByLabel(/^Label/)
      .press('Enter')
    await row(page, id).getByLabel(/^Type/).selectOption('standby')
    await expect
      .poll(() =>
        page.evaluate(
          async (cueId) =>
            (
              await window.__binder?.db.getAll<{ label: string; type: string }>(
                'SELECT label, type FROM cues WHERE id = ?',
                [cueId],
              )
            )?.[0],
          id,
        ),
      )
      .toEqual({ label: 'Sunrise', type: 'standby' })
    await synced(page)
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('a click on a placed row opens the viewer at its page with the cue selected', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const page = await openList(browser, 'owner', contexts)
    await clearCues(page)
    const id = randomUUID()
    await seed(page, [{ id, major: 55, label: 'On page two', pageIndex: 1, y: 600 }])
    await row(page, id).locator('.cue-page').click()
    await expect(page).toHaveURL(new RegExp(`/docs/${show.documentId}`))
    await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('2 / 3', {
      timeout: 30_000,
    })
    await expect(page.locator(`[data-cue-id="${id}"][data-selected="true"]`)).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('region', { name: 'Cue editor' })).toBeVisible()
    // The cue parameter is used once and leaves the address.
    await expect(page).not.toHaveURL(/cue=/)
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('a viewer sees the list but cannot edit or renumber it, and is told why', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const owner = await openList(browser, 'owner', contexts)
    await clearCues(owner)
    const id = randomUUID()
    await seed(owner, [{ id, major: 70, label: 'Look only', pageIndex: 0, y: 650 }])
    await synced(owner)

    const viewer = await openList(browser, 'viewer', contexts)
    await expect(row(viewer, id)).toBeVisible({ timeout: 20_000 })
    await expect(numberField(viewer, id)).toBeDisabled()
    await expect(viewer.getByRole('button', { name: 'Renumber from script order' })).toBeDisabled()
    await expect(viewer.getByText("You can't edit LX cues.")).toBeVisible()
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('600 renumbered cues upload cleanly', async ({ browser }) => {
  test.setTimeout(240_000)
  const COUNT = 600
  const contexts: BrowserContext[] = []
  try {
    const a = await openList(browser, 'owner', contexts)
    await clearCues(a)
    await synced(a)
    const b = await openList(browser, 'lxEditor', contexts)

    // Script order k runs down page 0, then 1, then 2 (200 cues a page, y descending), so the
    // reading order is unambiguous: k = 0..599 must come out as 10..609. Cues are created in a
    // shuffled order and start with scrambled numbers.
    const ids = Array.from({ length: COUNT }, () => randomUUID())
    const cues: SeedCue[] = []
    for (let n = 0; n < COUNT; n++) {
      const k = (n * 7919) % COUNT
      cues.push({
        id: ids[k] as string,
        major: 1000 + ((n * 31) % 997),
        label: `Cue ${k}`,
        pageIndex: Math.floor(k / 200),
        y: 780 - (k % 200) * 3.5,
      })
    }
    await seed(a, cues)
    await synced(a, 60_000)

    await a.getByRole('button', { name: 'Renumber from script order' }).click()
    const dialog = a.getByRole('dialog', { name: /Renumber LX/ })
    await expect(dialog.getByRole('status')).toContainText('cues will change')
    await dialog.getByRole('button', { name: 'Apply renumbering' }).click()
    await expect(dialog).toBeHidden()
    await synced(a, 60_000)
    await expect(a.getByRole('alert')).toHaveCount(0)

    const inScriptOrder = (page: Page) =>
      page.evaluate(async (fx) => {
        const rows =
          (await window.__binder?.db.getAll<{ major: number; minor: number }>(
            `SELECT major, minor FROM cues WHERE show_id = ? AND department_id = ?
             ORDER BY json_extract(anchor, '$.pageIndex'), json_extract(anchor, '$.y') DESC`,
            [fx.showId, fx.lxId],
          )) ?? []
        return rows.map((r) => (r.minor === 0 ? String(r.major) : `${r.major}.${r.minor}`))
      }, show)
    const expected = Array.from({ length: COUNT }, (_, i) => String(10 + i))
    expect(await inScriptOrder(a)).toEqual(expected)
    await expect.poll(() => inScriptOrder(b), { timeout: 60_000 }).toEqual(expected)
    await expect(b.getByRole('alert')).toHaveCount(0)
  } finally {
    for (const context of contexts) await context.close()
  }
})
