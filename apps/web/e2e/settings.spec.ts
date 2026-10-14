import { expect, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'

test('an owner manages departments and member scope; an editor sees them read-only', async ({
  browser,
}) => {
  const { sharedShow, users } = readRun()
  const url = `/shows/${sharedShow.id}/settings`
  const a = await (await browser.newContext({ storageState: storageStateFor('a') })).newPage()
  const b = await (await browser.newContext({ storageState: storageStateFor('b') })).newPage()
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

  // Owner scopes the editor to SND only.
  const bobRow = a
    .getByRole('list', { name: 'Members' })
    .getByRole('listitem')
    .filter({ hasText: users.b.name })
  await expect(bobRow).toBeVisible()
  await bobRow.getByLabel('All departments').click()
  await bobRow.getByLabel('SND', { exact: true }).click()
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeChecked()
  await bobRow.getByLabel('LX', { exact: true }).click()
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeChecked()
  await expect(bobRow.getByLabel('LX', { exact: true })).not.toBeChecked()

  await b.reload()
  await expect(
    b
      .getByRole('list', { name: 'Members' })
      .getByRole('listitem')
      .filter({ hasText: users.b.name }),
  ).toContainText('SND', { timeout: 20_000 })
  // The editor's page shows no controls.
  await expect(b.getByRole('combobox', { name: /role$/ })).toHaveCount(0)
})
