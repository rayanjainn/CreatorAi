import { expect, test } from '@playwright/test'
import { heroId, login } from './helpers'

test('command palette: Ctrl+K finds a page and a project', async ({ page }) => {
  await login(page)
  await expect(page.getByTestId('up-next')).toBeVisible() // the shell (and its shortcut) is mounted
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await page.getByTestId('command-input').fill('monetiz')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/monetization')
  await page.getByTestId('command-trigger').click()
  await page.getByTestId('command-input').fill('whole editing workflow')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/projects/*/plan')
})

test('teleprompter: reads the script, pace changes, plays after a countdown', async ({ page, request }) => {
  const id = await heroId(request)
  await login(page)
  await page.goto(`/projects/${id}/script`)
  await page.getByTestId('open-teleprompter').click()
  await page.waitForURL(`**/teleprompter/${id}`)
  await expect(page.getByTestId('tp-text')).toContainText('edit a video')
  await expect(page.getByTestId('tp-wpm')).toHaveText(/\d+ wpm/)
  const before = Number((await page.getByTestId('tp-wpm').innerText()).split(' ')[0])
  await page.keyboard.press('=')
  await expect(page.getByTestId('tp-wpm')).toHaveText(`${before + 10} wpm`)
  await page.getByTestId('tp-play').click()
  await expect(page.getByTestId('tp-play')).toHaveAttribute('aria-label', 'Pause', { timeout: 6000 })
})

test('dashboard shows the Up next panel', async ({ page }) => {
  await login(page)
  await expect(page.getByTestId('up-next')).toBeVisible()
})
