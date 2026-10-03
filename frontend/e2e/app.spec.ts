import { expect, test } from '@playwright/test'
import { apiFindCard, dragTo, login } from './helpers'

test.describe.configure({ mode: 'serial' })

test('guards: anonymous users go to /login; wrong password shows an error', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForURL('**/login?next=*')
  await page.fill('#email', 'demo@creatorai.local')
  await page.fill('#password', 'not-the-password')
  await page.click('[data-testid=login-submit]')
  await expect(page.getByTestId('login-error')).toContainText('do not match')
  await expect(page.getByRole('button', { name: /continue with google/i })).toBeDisabled()
})

test('signup is closed once an account exists', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-closed')).toBeVisible()
})

test('login skips onboarding (already done) and the dashboard shows seeded [DEMO] items', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('heading', { name: /what do you want/i })).toBeVisible()
  await expect(page.getByTestId('project-card').first()).toBeVisible()
  await expect(page.getByTestId('project-card').first().locator('.prov[data-source=demo]')).toBeVisible()
  // no fake numbers or people from the old prototype
  await expect(page.locator('body')).not.toContainText('Aarav')
  await expect(page.locator('body')).not.toContainText('8,450')
  // nothing configured + mock off => friendly setup card, never a fake "live" chip
  await expect(page.getByTestId('setup-card')).toContainText('GEMINI_API_KEY')
  await expect(page.getByTestId('live-chip')).toHaveCount(0)
})

test('drag a card to another column and it persists in the API', async ({ page, request }) => {
  await page.setViewportSize({ width: 1800, height: 900 }) // all six columns on screen
  await login(page)
  await page.goto('/calendar')
  const card = page.getByTestId('column-idea').getByTestId('content-card').filter({ hasText: 'Why your edits feel slow' })
  await expect(card).toBeVisible()
  const before = await apiFindCard(request, 'Why your edits feel slow')
  expect(before?.stage).toBe('idea')
  await dragTo(page, card, page.getByTestId('column-script').locator('.kanban-cards'))
  await expect(page.getByTestId('column-script').getByTestId('content-card').filter({ hasText: 'Why your edits feel slow' })).toBeVisible()
  await expect.poll(async () => (await apiFindCard(request, 'Why your edits feel slow'))?.stage).toBe('script')
  await page.reload()
  await expect(page.getByTestId('column-script').getByText('Why your edits feel slow')).toBeVisible()
})

test('keyboard-accessible move menu moves a card', async ({ page, request }) => {
  await login(page)
  await page.goto('/calendar')
  const card = page.getByTestId('column-script').getByTestId('content-card').filter({ hasText: 'Why your edits feel slow' })
  await card.getByRole('button', { name: /actions for/i }).click()
  await page.getByRole('menuitem', { name: 'Move to Idea' }).click()
  await expect.poll(async () => (await apiFindCard(request, 'Why your edits feel slow'))?.stage).toBe('idea')
})

test('moving to Shoot without a script is refused and rolled back', async ({ page, request }) => {
  await login(page)
  await page.goto('/calendar')
  const card = page.getByTestId('column-idea').getByTestId('content-card').filter({ hasText: 'The one export setting' })
  await card.getByRole('button', { name: /actions for/i }).click()
  await page.getByRole('menuitem', { name: 'Move to Shoot' }).click()
  await expect(page.getByText('Write a script first')).toBeVisible()
  await expect(page.getByTestId('column-idea').getByText('The one export setting')).toBeVisible()
  expect((await apiFindCard(request, 'The one export setting'))?.stage).toBe('idea')
})

test('create via the dashboard prompt box, then delete with the confirmation step', async ({ page, request }) => {
  await login(page)
  const title = `E2E idea ${Date.now()}`
  await page.getByTestId('prompt-input').fill(title)
  await page.getByTestId('prompt-submit').click()
  await page.waitForURL('**/projects/**')
  await expect(page.getByTestId('project-title')).toHaveText(title)
  expect((await apiFindCard(request, title))?.stage).toBe('idea')

  await page.goto('/calendar')
  const card = page.getByTestId('column-idea').getByTestId('content-card').filter({ hasText: title })
  await card.getByRole('button', { name: /actions for/i }).click()
  await page.getByRole('menuitem', { name: /delete/i }).click()
  await expect(page.getByTestId('cascade')).toBeVisible() // 409 CONFIRMATION_REQUIRED preview
  await expect(page.getByTestId('cascade')).toContainText('Scripts')
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(await apiFindCard(request, title)).toBeUndefined()
})

test('New content dialog creates a card in the chosen column', async ({ page, request }) => {
  await login(page)
  await page.goto('/calendar')
  await page.getByTestId('board-new').click()
  const title = `Dialog item ${Date.now()}`
  await page.getByLabel('Title').fill(title)
  await page.getByTestId('create-content-submit').click()
  await expect(page.getByTestId('column-idea').getByText(title)).toBeVisible()
  expect(await apiFindCard(request, title)).toBeTruthy()
})

test('settings: data mode, test keys with no providers, honest YouTube state', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await expect(page.getByTestId('data-mode-badge')).toHaveAttribute('data-mode', 'unconfigured')
  await page.getByTestId('test-keys').click()
  await expect(page.getByTestId('test-gemini')).toContainText('not configured')
  await expect(page.getByTestId('test-groq')).toContainText('not configured')
  await expect(page.getByTestId('not-available-inline')).toContainText('Not available yet')
  await expect(page.getByTestId('pipeline-card')).toContainText('ffmpeg')
})

test('deferred features render the honest not-available state', async ({ page }) => {
  await login(page)
  for (const route of ['/analytics', '/monetization', '/creative-twin']) {
    await page.goto(route)
    await expect(page.getByTestId('not-available')).toContainText('not built yet')
  }
  await page.goto('/assets')
  await expect(page.getByTestId('coming-next')).toContainText('Coming in the next build step')
  await page.goto('/board')
  await page.waitForURL('**/calendar')
  await page.goto('/does-not-exist')
  await expect(page.getByText('This page does not exist')).toBeVisible()
})

test('jobs & activity page lists seeded jobs and activity', async ({ page }) => {
  await login(page)
  await page.goto('/jobs')
  await expect(page.getByTestId('job-row').first()).toBeVisible()
  await expect(page.getByTestId('activity-row').first()).toBeVisible()
})

test('sign out returns to /login and protects the app again', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await page.getByTestId('signout').click()
  await page.waitForURL('**/login')
  await page.goto('/dashboard')
  await page.waitForURL('**/login?next=*')
})
