import { expect, test as setup } from '@playwright/test'
import { readRun, storageStateFor, USER_KEYS } from './env'

for (const key of USER_KEYS) {
  setup(`sign in ${key}`, async ({ page }) => {
    const { users, password } = readRun()
    await page.goto('/login')
    await page.getByLabel('Email').fill(users[key].email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Shows' })).toBeVisible()
    await page.context().storageState({ path: storageStateFor(key) })
  })
}
