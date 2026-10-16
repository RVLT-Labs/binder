import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { writeBlankScanPdf } from '../../api/test/scanHelpers'
import { storageStateFor } from './env'
import {
  anchorOnLine,
  archiveShow,
  call,
  createRevisionShow,
  cueEntry,
  newRowId,
  type RevisionShow,
  signInAsOwner,
  syncUpload,
  upload,
  uploadRevision,
  waitForVersion,
} from './revisionsHelpers'

/**
 * The responsive pass (Task 15): every screen of a show with a 40-character title and a 60-character
 * cue label, at the phone's 390 x 844, must not scroll sideways and must give every touch target at
 * least 44 x 44; at 1280 x 800 the rail is there and the tab bar is not. Screens the feature tasks
 * added are covered as they open: the print dialog, a failed upload row, the More screen with its
 * keep-offline switch, Calling mode and the palette.
 *
 * A control counts only when it can be seen: one that is clipped to nothing for screen readers
 * (`sr-only`) is skipped, and so is anything drawn inside the page overlay's SVG (cue tags, notes),
 * which the brief leaves out. Nothing else is exempt: an offender is fixed where it is built.
 */
test.use({ storageState: storageStateFor('owner') })
test.describe.configure({ mode: 'serial' })

const TITLE_LENGTH = 40
const LONG_LABEL = 'Blackout then the pirates storm the stage from the stalls'
  .padEnd(60, '!')
  .slice(0, 60)
const LONG_UPLOAD = 'Blocking notes for the pirates act one and the police chorus'
const LONG_EXPORT = 'cue-sheet-for-the-gala-night-opening-run-with-a-very-long-name-2026.csv'

let show: RevisionShow
let docPath = ''
const lx = newRowId()

test.beforeAll(async () => {
  test.setTimeout(300_000)
  const prefix = 'The Pirates of Penzance Gala Night'.slice(0, TITLE_LENGTH - 14)
  const title = `${prefix} ${Date.now()}`
  expect(title).toHaveLength(TITLE_LENGTH)
  show = await createRevisionShow(prefix, title)
  docPath = `/shows/${show.showId}/docs/${show.documentId}`
  const owner = await signInAsOwner()
  // A 60-character label on a cue, in a second version too: the cues, overview, activity and palette
  // all draw it.
  expect(LONG_LABEL).toHaveLength(60)
  await syncUpload(owner, [
    cueEntry(show, {
      id: lx,
      departmentId: show.lxId,
      major: 10,
      label: LONG_LABEL,
      anchor: await anchorOnLine(owner, show, show.versionId, 'Strong his arm'),
    }),
  ])
  // A second version, for Compare.
  const v2 = await uploadRevision(owner, show, 'Cuts for the gala night')
  await waitForVersion(owner, show.showId, show.documentId, v2, { current: true })
  // An upload Binder cannot read, with a long title: a failed row on the Documents screen.
  const scan = join(mkdtempSync(join(tmpdir(), 'binder-e2e-')), 'blocking-notes.pdf')
  writeBlankScanPdf(scan, 72)
  const failed = await upload(owner, `/api/shows/${show.showId}/documents`, scan, {
    kind: 'libretto',
    title: LONG_UPLOAD,
  })
  const deadline = Date.now() + 120_000
  for (;;) {
    const { documents } = await call<{
      documents: { id: string; versions: { id: string; status: string }[] }[]
    }>(owner, 'GET', `/api/shows/${show.showId}/documents`)
    const status = documents
      .flatMap((d) => d.versions)
      .find((v) => v.id === failed.version.id)?.status
    if (status === 'failed') break
    if (Date.now() > deadline) throw new Error(`the blank scan is ${status}, not failed`)
    await new Promise((r) => setTimeout(r, 1_000))
  }
  // An export with a long file name.
  const form = new FormData()
  const id = newRowId()
  form.append(
    'meta',
    JSON.stringify({ id, kind: 'csv', filename: LONG_EXPORT, layerSelection: [] }),
  )
  form.append('file', new Blob(['Cue,Label\n10,Go\n'], { type: 'text/csv' }), LONG_EXPORT)
  const made = await fetch(`http://localhost:3000/api/shows/${show.showId}/exports`, {
    method: 'POST',
    headers: { cookie: owner, origin: 'http://localhost:5173' },
    body: form,
  })
  if (!made.ok) throw new Error(`export: ${made.status} ${await made.text()}`)
})

test.afterAll(async () => {
  await archiveShow(show)
})

/** The controls the brief names, as one selector. */
const CONTROLS =
  'button, a, input, select, [role=button], [role=tab], [role=switch], [role=checkbox]'

interface Metrics {
  scrollWidth: number
  innerWidth: number
  mainOverflow: number
  /** How many controls were measured, so a test that measures nothing cannot pass. */
  checked: number
  offenders: string[]
}

/** Measures the page in the browser: sideways scroll and every visible control under 44 x 44. */
function measure(page: Page): Promise<Metrics> {
  return page.evaluate((selector) => {
    const name = (el: Element): string => {
      const h = el as HTMLElement
      const labelled = el.getAttribute('aria-labelledby')
      const byId = labelled
        ? labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
        : ''
      const labels = 'labels' in h ? Array.from((h as HTMLInputElement).labels ?? []) : []
      const text =
        el.getAttribute('aria-label') ||
        byId ||
        labels.map((l) => l.textContent).join(' ') ||
        h.innerText ||
        el.textContent ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        ''
      const tag = el.tagName.toLowerCase()
      const role = el.getAttribute('role')
      return `${tag}${role ? `[${role}]` : ''} "${text.trim().replace(/\s+/g, ' ').slice(0, 50)}"`
    }
    const offenders: string[] = []
    let checked = 0
    for (const el of Array.from(document.querySelectorAll(selector))) {
      // Inside the page overlay (an SVG over the script page): the brief excludes it.
      if (el.closest('svg')) continue
      // Hidden from assistive technology and out of the tab order (Radix's form bubble input): not a control.
      if (el.getAttribute('aria-hidden') === 'true' && (el as HTMLElement).tabIndex === -1) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      // Clipped to nothing for sighted people (`sr-only`): not a target anyone can aim at.
      if (rect.width <= 1 && rect.height <= 1) continue
      checked += 1
      // The element, or a larger ::after hit area the control draws for itself, must reach 44.
      const after = getComputedStyle(el, '::after')
      const afterBox =
        after.content !== 'none' && after.position === 'absolute'
          ? { w: Number.parseFloat(after.width), h: Number.parseFloat(after.height) }
          : null
      const w = Math.max(rect.width, afterBox && !Number.isNaN(afterBox.w) ? afterBox.w : 0)
      const h = Math.max(rect.height, afterBox && !Number.isNaN(afterBox.h) ? afterBox.h : 0)
      if (w < 43.5 || h < 43.5) {
        offenders.push(
          `${name(el)} ${Math.round(rect.width * 10) / 10} x ${Math.round(rect.height * 10) / 10}`,
        )
      }
    }
    const main = document.querySelector('main')
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      checked,
      offenders,
    }
  }, CONTROLS)
}

interface Screen {
  name: string
  /** Where it lives; `show` is the seeded one. */
  path: () => string
  /** Waits until the screen has its content, and opens whatever the screen is about (a dialog). */
  ready: (page: Page, phone: boolean) => Promise<void>
  /** Screens with a horizontally scrolling region of their own (the script's page stage) skip the `main` check. */
  stage?: boolean
}

/** The 60-character label is on the screen: as text (cards) or in a field (the table's cells). */
const longLabelShown = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(
          (label) =>
            document.body.innerText.includes(label) ||
            Array.from(document.querySelectorAll('input')).some((i) => i.value === label),
          LONG_LABEL,
        ),
      { timeout: 30_000 },
    )
    .toBe(true)

const openDocumentMenu = async (page: Page) => {
  await page.getByRole('button', { name: 'Document options' }).click()
}

const SCREENS: Screen[] = [
  {
    name: 'home',
    path: () => '/',
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Shows' })).toBeVisible()
      await expect(page.getByText(show.title).first()).toBeVisible({ timeout: 30_000 })
    },
  },
  {
    name: 'overview',
    path: () => `/shows/${show.showId}`,
    ready: async (page) => {
      await expect(page.getByText(show.title).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Loading…')).toHaveCount(0)
    },
  },
  {
    name: 'documents',
    path: () => `/shows/${show.showId}/docs`,
    ready: async (page) => {
      const rows = page.getByRole('list', { name: 'Documents' }).getByRole('listitem')
      await expect(rows.filter({ hasText: LONG_UPLOAD })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.version-status[data-status="failed"]').first()).toBeVisible()
    },
  },
  {
    name: 'script',
    path: () => docPath,
    stage: true,
    ready: async (page) => {
      await expect(page.locator('[data-page-index="0"] canvas')).toBeVisible({ timeout: 30_000 })
    },
  },
  {
    name: 'compare',
    path: () => `${docPath}/compare`,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Compare versions' })).toBeVisible()
      // The change list is a drawer behind "Changes" on a phone: the page's own caption says it is ready.
      await expect(page.getByText(/of the \d+ cut lines are on this page/)).toBeVisible({
        timeout: 60_000,
      })
    },
  },
  {
    name: 'cues',
    path: () => `/shows/${show.showId}/cues`,
    ready: async (page) => {
      await longLabelShown(page)
    },
  },
  {
    name: 'activity',
    path: () => `/shows/${show.showId}/activity`,
    ready: async (page) => {
      await expect(page.locator('main')).toContainText(/\S/, { timeout: 30_000 })
      await expect(page.getByText('Loading…')).toHaveCount(0)
    },
  },
  {
    name: 'exports',
    path: () => `/shows/${show.showId}/exports`,
    ready: async (page) => {
      await expect(page.getByText(LONG_EXPORT).first()).toBeVisible({ timeout: 30_000 })
    },
  },
  {
    name: 'settings',
    path: () => `/shows/${show.showId}/settings`,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Show settings' })).toBeAttached()
      await expect(page.getByText('Only the owner can change these.')).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByText('Loading…')).toHaveCount(0)
    },
  },
  {
    name: 'tokens',
    path: () => '/settings/tokens',
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: /token/i }).first()).toBeVisible()
    },
  },
  {
    name: 'more',
    path: () => `/shows/${show.showId}/more`,
    ready: async (page) => {
      await expect(page.getByRole('switch', { name: 'Make available offline' })).toBeVisible({
        timeout: 60_000,
      })
    },
  },
  {
    name: 'print',
    path: () => docPath,
    stage: true,
    ready: async (page, phone) => {
      await expect(page.locator('[data-page-index="0"] canvas')).toBeVisible({ timeout: 30_000 })
      if (phone) await openDocumentMenu(page)
      await page.getByRole('button', { name: 'Print', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Print' })).toBeVisible()
    },
  },
  {
    name: 'calling',
    path: () => `${docPath}?mode=calling`,
    stage: true,
    ready: async (page) => {
      await expect(page.getByRole('region', { name: 'Calling', exact: true })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.locator('[data-page-index="0"] canvas')).toBeVisible()
    },
  },
  {
    name: 'palette',
    path: () => `/shows/${show.showId}/cues`,
    ready: async (page, phone) => {
      await longLabelShown(page)
      // The phone has a button for it in the top bar; a desk has ⌘K (Ctrl+K here).
      if (phone) await page.getByRole('button', { name: 'Command palette' }).click()
      else await page.keyboard.press('Control+k')
      const palette = page.getByRole('dialog', { name: 'Command palette' })
      await expect(palette).toBeVisible()
      await palette.getByRole('combobox').fill('lx 10')
      await expect(palette.getByRole('option').first()).toBeVisible()
    },
  },
]

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test('at 390 x 844 it does not scroll sideways and every control is at least 44 x 44', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(screen.path())
      await screen.ready(page, true)
      // Layout settles after fonts and the first paint.
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(400)
      const m = await measure(page)
      expect(m.scrollWidth, 'document scrollWidth').toBeLessThanOrEqual(m.innerWidth)
      if (!screen.stage)
        expect(m.mainOverflow, '<main> overflows sideways by').toBeLessThanOrEqual(0)
      expect(m.checked, 'controls measured').toBeGreaterThan(3)
      expect(m.offenders, 'controls under 44 x 44').toEqual([])
    })

    test('at 1280 x 800 the rail is shown and the tab bar is not', async ({ page }) => {
      test.skip(screen.name === 'calling', 'Calling mode hides the shell: there is no rail in it')
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(screen.path())
      await screen.ready(page, false)
      await expect(page.getByRole('navigation', { name: 'Binder' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Show' })).toHaveCount(0)
    })
  })
}

test('the login screen fits a phone too', async ({ browser }) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  })
  try {
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in to Binder' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const m = await measure(page)
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth)
    expect(m.offenders).toEqual([])
  } finally {
    await context.close()
  }
})
