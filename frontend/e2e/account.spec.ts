import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('settings: export downloads a JSON of my work; the wipe asks for the word DELETE', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  const card = page.getByTestId('account-card')
  await expect(card).toBeVisible()
  const download = page.waitForEvent('download')
  await card.getByTestId('export-data').click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^creatorai-export-\d{4}-\d{2}-\d{2}\.json$/)
  await card.getByTestId('wipe-data').click()
  await page.getByTestId('wipe-confirm').fill('delete')
  await page.getByRole('button', { name: 'Wipe everything' }).click()
  await expect(page.getByTestId('wipe-confirm')).toBeVisible() // nothing happens without the exact word
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('login: the forgot-password hint points to the command that keeps your work', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Forgot your password?' }).click()
  await expect(page.getByText('make reset-password')).toBeVisible()
})
