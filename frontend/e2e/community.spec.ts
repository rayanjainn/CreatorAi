import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, apiGet, authHeaders, login } from './helpers'

/**
 * Community feed through the real API and UI: the creator shares a library video with platforms and tags, a second person
 * (brought in with an invite link; she signs in to her own workspace) sees it, likes it and leaves feedback, the creator replies, edits and
 * finally deletes the post. The second person is removed at the end so other specs find the team as before.
 */
test.describe.configure({ mode: 'serial' })

type Post = { id: string; title: string; like_count: number; comment_count: number }

async function invitee(request: APIRequestContext, email: string, password: string): Promise<{ token: string; userId: string }> {
  const headers = await authHeaders(request)
  const inv = await request.post(`${API}/api/v1/workspace/invites`, { headers, data: { email, role: 'viewer' } })
  expect(inv.ok(), await inv.text()).toBeTruthy()
  const res = await request.post(`${API}/api/v1/auth/signup`, { data: { email, password, display_name: 'Rita Reviewer', invite_token: (await inv.json()).token } })
  expect(res.ok(), await res.text()).toBeTruthy()
  const body = await res.json()
  // her own home workspace is new: finish its onboarding so the app opens on the dashboard
  const onboard = await request.post(`${API}/api/v1/onboarding`, { headers: { Authorization: `Bearer ${body.access_token}` }, data: { display_name: 'Rita Reviewer', domain: 'technology' } })
  expect(onboard.ok(), await onboard.text()).toBeTruthy()
  return { token: body.access_token, userId: body.user.id }
}

test('share a video, get a like and feedback from someone else, reply, edit, delete', async ({ page, browser, request }) => {
  test.setTimeout(150_000) // two browsers and a dozen page loads
  const title = `Hook test ${Date.now()}`
  await login(page)
  await page.goto('/community')
  await expect(page.getByRole('heading', { name: 'Community' })).toBeVisible()

  // share a ready library video (the e2e seed has no renders; the render path is covered by the backend tests)
  await page.getByTestId('new-post').click()
  const form = page.getByTestId('new-post-form')
  await form.getByRole('button', { name: 'A library video' }).click()
  const asset = form.getByTestId('post-asset')
  await expect(asset.locator('option')).not.toHaveCount(1)
  await asset.selectOption({ index: 1 })
  await form.getByTestId('post-title').fill(title)
  await form.getByTestId('post-body').fill('Does the hook land in the first two seconds?')
  await form.getByTestId('platform-tiktok').click()
  await form.getByTestId('platform-youtube').click()
  await expect(form.getByTestId('platform-tiktok')).toHaveAttribute('aria-pressed', 'true')
  await form.getByTestId('post-tags').fill('#Hooks, editing')
  await form.getByTestId('post-submit').click()

  await page.waitForURL('**/community/*')
  await expect(page.getByTestId('post-title')).toHaveText(title)
  await expect(page.getByTestId('post-body')).toContainText('first two seconds')
  await expect(page.locator('.cp-platform[data-platform=tiktok]')).toBeVisible()
  await expect(page.locator('.tag-chip')).toHaveText(['#hooks', '#editing'])
  const postId = page.url().split('/').pop()!
  const posted = await apiGet<Post>(request, `/community/posts/${postId}`)
  expect(posted.title).toBe(title)

  // someone else on the server: sees it in the feed, likes it, comments
  const email = `rita.${Date.now()}@example.test`
  const rita = await invitee(request, email, 'reviewer-pass-1')
  const ctx = await browser.newContext()
  const r = await ctx.newPage()
  await r.goto('/login')
  await r.fill('#email', email)
  await r.fill('#password', 'reviewer-pass-1')
  await r.click('[data-testid=login-submit]')
  await r.waitForURL('**/dashboard')
  await r.goto('/community')
  // Rita works in her own home workspace, yet sees the post: the feed is shared by every account on the server
  await expect(r.getByTestId('new-post')).toBeVisible()
  const card = r.getByTestId('post-card').filter({ hasText: title })
  await expect(card).toBeVisible()
  await card.getByTestId('like').click()
  await expect(card.getByTestId('like-count')).toHaveText('1')
  await expect(card.getByTestId('like')).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('link', { name: `Open “${title}”` }).click()
  await r.waitForURL(`**/community/${postId}`)
  await expect(r.getByTestId('edit-post')).toHaveCount(0) // not the author
  await r.getByTestId('community-comment-input').fill('Hook lands. Cut the first half second of silence.')
  await r.getByTestId('community-comment-send').click()
  await expect(r.getByTestId('community-comment')).toHaveCount(1)
  await expect(r.getByTestId('community-comment').first()).toContainText('Rita Reviewer')

  // the author sees it, replies in the thread
  await page.reload()
  const thread = page.getByTestId('community-comment').first()
  await expect(thread).toContainText('Cut the first half second')
  await thread.getByTestId('reply').click()
  await page.getByTestId('reply-input').fill('Thanks, trimmed it.')
  await page.getByTestId('reply-send').click()
  await expect(page.getByTestId('community-comment')).toHaveCount(2)
  await expect(page.locator('.cp-replies')).toContainText('Thanks, trimmed it.')
  await expect(page.locator('.cp-replies [data-testid=community-comment]')).toContainText('Author')

  // the reviewer sees the reply; a like from the author too
  await r.reload()
  await expect(r.locator('.cp-replies')).toContainText('Thanks, trimmed it.')
  const after = await apiGet<Post>(request, `/community/posts/${postId}`)
  expect(after.like_count).toBe(1)
  expect(after.comment_count).toBe(2)

  // filters: by platform and "only mine"
  await page.goto('/community')
  await page.getByTestId('platform-filter').selectOption('instagram')
  await expect(page.getByTestId('post-card').filter({ hasText: title })).toHaveCount(0)
  await page.getByTestId('platform-filter').selectOption('tiktok')
  await expect(page.getByTestId('post-card').filter({ hasText: title })).toBeVisible()
  await page.getByTestId('platform-filter').selectOption('')
  await page.getByTestId('mine-filter').check()
  await expect(page.getByTestId('post-card').filter({ hasText: title })).toBeVisible()

  // edit, then delete: gone for everyone
  await page.goto(`/community/${postId}`)
  await page.getByTestId('edit-post').click()
  await page.locator('#ep-title').fill(`${title} v2`)
  await page.getByTestId('save-post').click()
  await expect(page.getByTestId('post-title')).toHaveText(`${title} v2`)
  await page.getByTestId('delete-post').click()
  await page.getByRole('button', { name: 'Delete post' }).click()
  await page.waitForURL('**/community')
  await expect(page.getByTestId('post-card').filter({ hasText: title })).toHaveCount(0)
  await r.reload()
  await expect(r.getByText('This post is gone')).toBeVisible()

  await ctx.close()
  const del = await request.delete(`${API}/api/v1/workspace/members/${rita.userId}`, { headers: await authHeaders(request) })
  expect(del.ok()).toBeTruthy()
})
