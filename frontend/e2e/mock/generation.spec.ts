import { expect, test } from '@playwright/test'
import { apiGet, createItem, heroId, login } from '../helpers'

// Runs only in the `mock` project: the API was restarted with LLM_ALLOW_MOCK=true. Everything generated here
// must be unmistakably labelled as mock.
test.describe.configure({ mode: 'serial' })

test('mock mode: the loud banner and chip are visible', async ({ page }) => {
  await login(page)
  await expect(page.getByTestId('mock-banner')).toContainText('MOCK MODE')
  await expect(page.getByTestId('mock-chip').first()).toBeVisible()
})

test('hooks -> script -> edit -> approve -> moved to Shoot, all labelled MOCK', async ({ page, request }) => {
  const id = await createItem(request, `E2E script ${Date.now()}`, { objective: 'Show how I edit fast', target_duration_sec: 40 })
  await login(page)
  await page.goto(`/projects/${id}/script`)
  await expect(page.getByTestId('mock-banner')).toBeVisible()
  await page.getByTestId('generate-hooks').click()
  const options = page.getByTestId('hook-option')
  await expect(options.first()).toBeVisible()
  await expect(options.first().locator('.prov[data-source=mock]')).toBeVisible()
  await expect(options.first().getByTestId('hook-type')).not.toBeEmpty()
  const hookText = (await options.first().locator('p').innerText()).trim()
  await options.first().getByTestId('use-hook').click()
  await expect(options.first().getByTestId('use-hook')).toContainText('Selected')

  await page.getByTestId('generate-script').click()
  await expect(page.getByTestId('script-editor')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('script-bar').locator('.prov[data-source=mock]')).toBeVisible()
  expect(await page.getByTestId('scene-text').first().inputValue()).toContain(hookText.split(' ')[0])
  await expect(page.getByTestId('twin-banner')).toHaveCount(0)

  // edit: dirty indicator, autosave, "You" provenance, saved through the API
  const text = page.getByTestId('scene-text')
  await text.fill(`${hookText} This is my own sentence.`)
  await expect(page.getByTestId('dirty-indicator')).toContainText(/Unsaved|Saving/)
  await expect(page.getByTestId('dirty-indicator')).toContainText('All changes saved', { timeout: 15_000 })
  await expect(page.getByTestId('script-editor').locator('.prov[data-source=user]').first()).toBeVisible()
  const script = await apiGet<{ scenes: { text: string }[]; approved: boolean }>(request, `/content/${id}/script`)
  expect(script.scenes[0].text).toContain('my own sentence')

  // per-scene tools and metadata
  await page.getByTestId('tighten-scene').click()
  await expect(page.getByText(/words\./)).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('generate-meta').click()
  await expect(page.getByTestId('meta-block').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('meta-panel').locator('.prov[data-source=mock]')).toBeVisible()

  // approve moves the project to Shoot
  await page.getByTestId('approve-script').click()
  await expect(page.getByTestId('approved-chip')).toBeVisible()
  await expect(page.getByTestId('project-header').locator('.stage-badge')).toHaveText('Shoot')
  expect((await apiGet<{ stage: string }>(request, `/content/${id}`)).stage).toBe('shoot')
  // history
  await expect(page.getByTestId('script-version').first()).toBeVisible()
})

test('director plan and review are labelled: scores heuristic, wording mock; go to timestamp opens the footage', async ({ page, request }) => {
  const id = await heroId(request)
  await login(page)
  await page.goto(`/projects/${id}/plan`)
  await page.getByTestId('new-plan').click()
  await page.getByTestId('generate-plan').click()
  await expect(page.getByTestId('plan-view').locator('.prov[data-source=mock]').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('plan-version')).toBeVisible()
  await expect(page.getByTestId('shot-row').first()).toBeVisible()

  await page.getByTestId('run-review').click()
  await expect(page.getByTestId('score-ring').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('score-hook')).toBeVisible()
  const prov = page.getByTestId('review-provenance')
  await expect(prov.locator('.prov[data-source=heuristic]')).toBeVisible()
  await expect(prov.locator('.prov[data-source=mock]')).toBeVisible()
  const goto = page.getByTestId('issue-goto').first()
  if (await goto.count()) {
    await goto.click()
    await expect(page.getByTestId('asset-drawer')).toBeVisible()
    await expect(page.getByTestId('player')).toHaveAttribute('data-seek-target', /\d/)
  }
})

test('review without a transcript explains what is missing', async ({ page, request }) => {
  const id = await createItem(request, `E2E empty review ${Date.now()}`)
  await login(page)
  await page.goto(`/projects/${id}/plan`)
  await page.getByTestId('run-review').click()
  await expect(page.getByTestId('review-not-ready')).toBeVisible()
})
