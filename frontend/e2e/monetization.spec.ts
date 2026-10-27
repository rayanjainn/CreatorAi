import { expect, test } from '@playwright/test'
import { API, apiGet, authHeaders, heroId, login } from './helpers'

test.describe.configure({ mode: 'serial' })

test('deals: add, see it on the board and in the totals, move it, pitch needs a key', async ({ page }) => {
  await login(page)
  await page.goto('/monetization')
  await expect(page.getByTestId('monetization-page')).toBeVisible()
  const brand = `E2E Brand ${Date.now()}`
  await page.getByTestId('new-deal').click()
  await page.getByTestId('deal-brand').fill(brand)
  await page.getByTestId('deal-fee').fill('1500')
  await page.getByTestId('deal-stage').selectOption('negotiating')
  await page.getByTestId('deal-save').click()
  const card = page.getByTestId('deal-card').filter({ hasText: brand })
  await expect(card).toBeVisible()
  await expect(page.locator('.mon-col[data-stage=negotiating]').getByText(brand)).toBeVisible()
  await expect(page.getByTestId('deal-summary')).toContainText('1,500')
  await card.getByTestId('deal-move').selectOption('paid')
  await expect(page.locator('.mon-col[data-stage=paid]').getByText(brand)).toBeVisible()
  await expect(page.getByTestId('deal-summary')).toContainText('Paid')
  // key-less: the pitch says what to configure and writes nothing
  await page.locator('.mon-col[data-stage=paid]').getByTestId('deal-card').filter({ hasText: brand }).getByTestId('deal-pitch').click()
  await page.getByTestId('pitch-generate').click()
  await expect(page.getByTestId('llm-not-configured')).toBeVisible()
  await expect(page.getByTestId('pitch-output')).toHaveCount(0)
})

test('rate calculator: a labelled formula over your own numbers', async ({ page }) => {
  await login(page)
  await page.goto('/monetization')
  await page.getByRole('button', { name: 'Rate calculator' }).click()
  await page.getByTestId('rate-views').fill('20000')
  await page.getByTestId('rate-run').click()
  const out = page.getByTestId('rate-result')
  await expect(out).toContainText('400')
  await expect(out).toContainText('800')
  await expect(out.locator('.prov[data-source=heuristic]')).toBeVisible()
  await expect(out).toContainText('Your own history')
})

test('sponsors tab: brief, key-less slots badged heuristic, write the read, place it in the full cut', async ({ page, request }) => {
  const id = await heroId(request)
  await login(page)
  await page.goto(`/projects/${id}/sponsors`)
  await expect(page.getByTestId('sponsors-page')).toBeVisible()
  await page.getByTestId('new-brief').click()
  await page.getByTestId('brief-brand').fill('Acme')
  await page.getByTestId('brief-product').fill('Acme Cloud')
  await page.getByTestId('brief-save').click()
  const brief = page.getByTestId('brief-card').filter({ hasText: 'Acme Cloud' })
  await expect(brief).toBeVisible()
  await brief.getByTestId('find-slots').click()
  const slot = brief.getByTestId('slot-card').first()
  await expect(slot).toBeVisible({ timeout: 30_000 })
  await expect(slot.locator('.prov[data-source=heuristic]')).toBeVisible()
  await expect(brief.getByTestId('slot-warning').filter({ hasText: 'no AI provider' })).toBeVisible()
  await slot.getByTestId('slot-script').fill('This part of the video is brought to you by Acme Cloud. Use code CREATOR.')
  await slot.getByRole('button', { name: 'Save read' }).click()
  await expect(slot.locator('.prov[data-source=user]')).toBeVisible()
  // ensure a full cut exists to place the read into
  const clips = await apiGet<{ id: string; kind: string }[]>(request, `/content/${id}/clips`)
  if (!clips.some((c) => c.kind === 'full')) {
    const res = await request.post(`${API}/api/v1/content/${id}/clips/generate`, { headers: await authHeaders(request), data: { count: 1, include_full_cut: true } })
    expect(res.ok()).toBeTruthy()
    await expect.poll(async () => (await apiGet<{ kind: string }[]>(request, `/content/${id}/clips`)).some((c) => c.kind === 'full'), { timeout: 60_000 }).toBe(true)
    await page.reload()
  }
  const target = page.getByTestId('slot-card').first()
  const full = (await apiGet<{ id: string; kind: string }[]>(request, `/content/${id}/clips`)).find((c) => c.kind === 'full')!
  await target.getByTestId('slot-clip').selectOption(full.id)
  await target.getByTestId('slot-accept').click()
  await expect(target.getByTestId('slot-placed')).toBeVisible()
  const edit = await apiGet<{ timeline: { tracks: { video: { kind: string }[]; overlays: { text: string }[] } } }>(request, `/clips/${full.id}/edit`)
  expect(edit.timeline.tracks.video.some((v) => v.kind === 'sponsor')).toBe(true)
  expect(edit.timeline.tracks.overlays.some((o) => o.text === 'Sponsored · Acme')).toBe(true)
})
