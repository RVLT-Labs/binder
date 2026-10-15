import { expect, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'

test('an owner manages departments and member scope; an editor sees them read-only', async ({
  browser,
}) => {
  const { sharedShow, users } = readRun()
  const url = `/shows/${sharedShow.id}/settings`
  const a = await (await browser.newContext({ storageState: storageStateFor('owner') })).newPage()
  const b = await (
    await browser.newContext({ storageState: storageStateFor('sndEditor') })
  ).newPage()
  await a.goto(url)
  await b.goto(url)

  const departments = (page: typeof a) => page.getByRole('list', { name: 'Departments' })
  const row = (page: typeof a, code: string) =>
    departments(page).getByRole('listitem').filter({ hasText: code })

  // Seeded departments reach both users through sync.
  for (const code of ['LX', 'SND', 'TM', 'VID', 'SM', 'STG', 'FLY']) {
    await expect(row(a, code)).toBeVisible({ timeout: 20_000 })
    await expect(row(b, code)).toBeVisible({ timeout: 20_000 })
  }
  await expect(b.getByText('Only owners can change these settings.')).toBeVisible()
  await expect(b.getByRole('form', { name: 'Add department' })).toHaveCount(0)
  await expect(a.getByRole('form', { name: 'Add department' })).toBeVisible()

  // Owner adds PYRO (the code is upper-cased) and hides VID; the editor sees both change.
  const add = a.getByRole('form', { name: 'Add department' })
  await add.getByLabel('New department code').fill('pyro')
  await add.getByLabel('New department name').fill('Pyrotechnics')
  await add.getByRole('button', { name: 'Add department' }).click()
  await expect(row(a, 'PYRO')).toBeVisible({ timeout: 10_000 })
  await expect(row(b, 'PYRO')).toBeVisible({ timeout: 10_000 })
  // The box follows the synced row, so it flips once the change comes back: click, then wait.
  await row(a, 'VID').getByLabel('Hidden').click()
  await expect(row(a, 'VID').getByLabel('Hidden')).toBeChecked({ timeout: 10_000 })
  await expect(row(b, 'VID')).toContainText('hidden', { timeout: 10_000 })
  // A duplicate code is refused with the server's message.
  await add.getByLabel('New department code').fill('LX')
  await add.getByLabel('New department name').fill('Again')
  await add.getByRole('button', { name: 'Add department' }).click()
  await expect(add.getByRole('alert')).toContainText('already exists')

  // The editor starts scoped to SND (global setup). Owner grants every department, then scopes
  // the editor back to SND only.
  const bobRow = a
    .getByRole('list', { name: 'Members' })
    .getByRole('listitem')
    .filter({ hasText: users.sndEditor.name })
  await expect(bobRow).toBeVisible()
  await expect(bobRow.getByLabel('All departments')).not.toBeChecked()
  await bobRow.getByLabel('All departments').click()
  await expect(bobRow.getByLabel('All departments')).toBeChecked()
  await expect(bobRow.getByLabel('SND', { exact: true })).toHaveCount(0)
  await bobRow.getByLabel('All departments').click()
  await bobRow.getByLabel('SND', { exact: true }).click()
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeChecked()
  await bobRow.getByLabel('LX', { exact: true }).click()
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeChecked()
  await expect(bobRow.getByLabel('LX', { exact: true })).not.toBeChecked()
  // The last department cannot be unticked (that would widen the scope), and says why.
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeDisabled()
  await expect(bobRow).toContainText("choose 'All departments'")

  await b.reload()
  await expect(
    b
      .getByRole('list', { name: 'Members' })
      .getByRole('listitem')
      .filter({ hasText: users.sndEditor.name }),
  ).toContainText('SND', { timeout: 20_000 })
  // The editor's page shows no controls.
  await expect(b.getByRole('combobox', { name: /role$/ })).toHaveCount(0)
})

test('the owner picks the paper size for cue sheets; another member sees it read-only and it reaches them', async ({
  browser,
}) => {
  const { sharedShow } = readRun()
  const url = `/shows/${sharedShow.id}/settings`
  const a = await (await browser.newContext({ storageState: storageStateFor('owner') })).newPage()
  const b = await (
    await browser.newContext({ storageState: storageStateFor('sndEditor') })
  ).newPage()
  await a.goto(url)
  await b.goto(url)
  const paper = a.getByLabel('Paper size')
  try {
    await expect(paper).toHaveValue('A4', { timeout: 20_000 })
    await expect(b.getByLabel('Paper size')).toHaveCount(0)
    await expect(b.getByText('A4 (210 × 297 mm)')).toBeVisible({ timeout: 20_000 })

    await paper.selectOption('Letter')
    await expect(b.getByText('Letter (8.5 × 11 in)')).toBeVisible({ timeout: 20_000 })
    // Other settings are not lost: the stamp set is still the seven defaults.
    await expect(a.getByRole('list', { name: 'Stamps' }).getByRole('listitem')).toHaveCount(7)
  } finally {
    await paper.selectOption('A4')
    await expect(b.getByText('A4 (210 × 297 mm)')).toBeVisible({ timeout: 20_000 })
  }
})
