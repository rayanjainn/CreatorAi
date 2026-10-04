import { expect, test } from '@playwright/test'
import { API, apiGet, authHeaders, heroId, login } from './helpers'

/**
 * Collaboration end to end: the owner invites a viewer by link, the viewer signs up through it, sees a read-only workspace
 * but can comment, and the owner sees the comment. The member is removed at the end so other specs find the team as before.
 */
test.describe.configure({ mode: 'serial' })

test('invite a viewer: sign-up through the link, read-only UI, comments both ways', async ({ page, browser, request }) => {
  const email = `viewer.${Date.now()}@example.test`
  const id = await heroId(request)
  const headers = await authHeaders(request)

  // owner creates the invite from Settings -> Team
  await login(page)
  await page.goto('/settings')
  await expect(page.getByTestId('team-card')).toBeVisible()
  await page.getByTestId('invite-open').click()
  await page.getByTestId('invite-email').fill(email)
  await page.getByTestId('invite-role').selectOption('viewer')
  await page.getByTestId('invite-submit').click()
  const link = await page.getByTestId('invite-link').inputValue()
  expect(link).toContain('/invite/')

  // the viewer opens the link in a clean browser and signs up
  const ctx = await browser.newContext()
  const v = await ctx.newPage()
  await v.goto(new URL(link).pathname)
  await expect(v.getByTestId('invite-card')).toContainText(email)
  await v.getByPlaceholder('Your name').fill('Vera Viewer')
  await v.getByPlaceholder(/Choose a password/).fill('viewer-pass-1')
  await v.getByTestId('invite-signup').click()
  await v.waitForURL('**/dashboard')

  // read-only: no "New content", and the project shows "View only"
  await expect(v.getByTestId('new-content')).toHaveCount(0)
  await v.goto(`/projects/${id}/plan`)
  await expect(v.getByTestId('view-only')).toBeVisible()
  await expect(v.getByTestId('rename-project')).toHaveCount(0)

  // viewers may comment
  await v.getByTestId('comments-open').click()
  await v.getByTestId('comment-input').fill('Looks great, tighten the intro?')
  await v.getByTestId('comment-send').click()
  await expect(v.getByTestId('comment').first()).toContainText('tighten the intro')

  // the API refuses a write from the viewer
  const tok = await v.evaluate(() => localStorage.getItem('creatorai.token'))
  const ws = await v.evaluate(() => localStorage.getItem('creatorai.workspace'))
  const res = await request.patch(`${API}/api/v1/content/${id}`, { headers: { Authorization: `Bearer ${tok}`, 'X-Workspace-Id': ws ?? '' }, data: { title: 'hacked' } })
  expect(res.status()).toBe(403)

  // the owner sees the comment and the new member
  const comments = await apiGet<{ author_name: string; body: string }[]>(request, `/content/${id}/comments`)
  expect(comments.some((c) => c.author_name === 'Vera Viewer')).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('team-members')).toContainText('Vera Viewer')

  // clean up: delete the comment's member
  const members = await apiGet<{ user_id: string; email: string }[]>(request, '/workspace/members')
  const m = members.find((x) => x.email === email)!
  expect((await request.delete(`${API}/api/v1/workspace/members/${m.user_id}`, { headers })).ok()).toBeTruthy()
  await ctx.close()
})

test('an invalid invite link says so', async ({ page }) => {
  await page.goto('/invite/not-a-real-token')
  await expect(page.getByTestId('invite-invalid')).toBeVisible()
})
