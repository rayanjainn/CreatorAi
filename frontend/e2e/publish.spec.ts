import { expect, test } from '@playwright/test'
import { heroId, login } from './helpers'

test('publish tab without a Google client: explains the setup, links Settings, invents nothing', async ({ page, request }) => {
  const id = await heroId(request)
  await login(page)
  await page.goto(`/projects/${id}/publish`)
  await expect(page.getByTestId('publish-connect')).toContainText('not set up')
  await expect(page.getByTestId('publish-form')).toHaveCount(0)
  await page.getByRole('link', { name: 'Open Settings' }).click()
  await page.waitForURL('**/settings**')
  await expect(page.getByTestId('youtube-setup')).toContainText('YouTube Data API v3')
  await expect(page.getByTestId('youtube-setup')).toContainText('/api/v1/youtube/oauth/callback')
})

test('insights: no performance numbers without published videos', async ({ page }) => {
  await login(page)
  await page.goto('/analytics')
  await expect(page.getByTestId('performance-note')).toContainText('connected YouTube channel')
})
