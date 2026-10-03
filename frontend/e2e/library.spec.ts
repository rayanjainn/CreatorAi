import { expect, test } from '@playwright/test'
import { API, apiGet, authHeaders, login, makeDemoClip } from './helpers'

test.describe.configure({ mode: 'serial' })

type Asset = { id: string; filename: string; status: string }

test('library lists the hero asset with its provenance badge and the caption warning', async ({ page }) => {
  await login(page)
  await page.goto('/assets')
  await expect(page.getByRole('heading', { name: 'Asset Library' })).toBeVisible()
  const card = page.getByTestId('asset-card').filter({ hasText: 'hero_demo.mp4' })
  await expect(card).toBeVisible()
  await expect(card.locator('.prov')).toBeVisible()
  await expect(card.getByTestId('asset-status')).toContainText('Ready')
  await expect(card.getByTestId('asset-warning')).toHaveAttribute('data-code', 'CAPTIONS_UNAVAILABLE')
  // grid / list toggle and a type filter that matches nothing
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('asset-list')).toBeVisible()
  await page.getByRole('button', { name: 'Audio', exact: true }).click()
  await expect(page.getByText('No assets match these filters')).toBeVisible()
})

test('search finds the hero moment and "jump to moment" opens the drawer seeked to it', async ({ page, request }) => {
  const res = await request.get(`${API}/api/v1/search`, { params: { q: 'trim the dead air' }, headers: await authHeaders(request) })
  const hit = (await res.json()).results[0] as { start_sec: number; asset_id: string }
  await login(page)
  await page.goto('/search?q=trim%20the%20dead%20air')
  const moment = page.getByTestId('moment-card').first()
  await expect(moment).toContainText('hero_demo.mp4')
  await expect(moment.locator('mark').first()).toBeVisible()
  await expect(page.getByTestId('search-results').locator('.prov')).toBeVisible() // hashing embedder: heuristic
  await moment.getByTestId('jump-to-moment').click()
  await expect(page.getByTestId('asset-drawer')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`asset=${hit.asset_id}`))
  const seek = Number(await page.getByTestId('player').getAttribute('data-seek-target'))
  expect(Math.abs(seek - hit.start_sec)).toBeLessThan(0.2)
  await expect(page.locator('[data-testid=transcript-segment][data-active=true]')).toContainText('trim the dead air')
  // deep link survives a reload; Escape closes it
  await page.reload()
  await expect(page.getByTestId('asset-drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('asset-drawer')).toHaveCount(0)
})

test('the topbar search navigates to /search?q=', async ({ page }) => {
  await login(page)
  await page.fill('#global-search', 'export a vertical version')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/search?q=*')
  await expect(page.getByTestId('library-search')).toHaveValue('export a vertical version')
  await expect(page.getByTestId('moment-card').first()).toBeVisible()
})

test('asset detail: clicking a transcript word seeks the player; shots and details tabs work', async ({ page, request }) => {
  const assets = (await apiGet<{ items: Asset[] }>(request, '/assets')).items
  const hero = assets.find((a) => a.filename === 'hero_demo.mp4')!
  await login(page)
  await page.goto(`/assets?asset=${hero.id}`)
  const word = page.getByTestId('transcript').locator('.t-word', { hasText: /^Color$/ }).first()
  await expect(word).toBeVisible()
  const start = Number(await word.getAttribute('data-start'))
  await word.click()
  await expect.poll(async () => Number(await page.getByTestId('player').getAttribute('data-seek-target'))).toBeCloseTo(start, 1)
  await expect(page.getByTestId('player-time')).toContainText(`0:${String(Math.floor(start)).padStart(2, '0')}`)
  await expect(page.locator('[data-testid=transcript-segment][data-active=true]')).toContainText('Color correction')
  await page.getByRole('button', { name: /^Shots/ }).click()
  await expect(page.getByTestId('shot-card')).toHaveCount(5)
  await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByTestId('tab-details')).toContainText('Transcribe')
  await expect(page.getByTestId('tab-details').locator('.prov[data-source=demo]').first()).toBeVisible()
})

test('tags and description are edited through the API', async ({ page, request }) => {
  const hero = (await apiGet<{ items: Asset[] }>(request, '/assets')).items.find((a) => a.filename === 'hero_demo.mp4')!
  await login(page)
  await page.goto(`/assets?asset=${hero.id}`)
  await page.getByRole('button', { name: 'Details' }).click()
  await page.getByLabel('Add to Tags').fill('e2e-tag')
  await page.getByLabel('Add to Tags').press('Enter')
  await expect(page.getByTestId('tag-editor')).toContainText('e2e-tag')
  await expect.poll(async () => (await apiGet<{ tags: string[] }>(request, `/assets/${hero.id}`)).tags).toContain('e2e-tag')
  await page.getByLabel('Description').fill('Hero footage for the e2e suite')
  await page.getByLabel('Description').blur()
  await expect(page.getByText('Saved')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/assets')
  await page.getByLabel('Filter by tag').selectOption('e2e-tag')
  await expect(page.getByTestId('asset-card')).toHaveCount(1)
})

test('chunked upload: progress, ASR_UNAVAILABLE -> attach transcript -> ready, then dedupe', async ({ page, request }) => {
  const clip = makeDemoClip(`${Date.now()}`)
  await login(page)
  await page.goto('/assets')
  // slow every chunk so the progress UI is observable on a local connection
  let chunks = 0
  await page.route('**/api/v1/uploads/*/chunks/*', async (route) => {
    chunks++
    await new Promise((r) => setTimeout(r, 500))
    await route.continue()
  })
  await page.getByTestId('open-upload').click()
  await page.getByTestId('upload-input').setInputFiles(clip.video)
  const row = page.getByTestId('upload-row').first()
  await expect(row).toHaveAttribute('data-phase', 'uploading')
  await expect(row.getByTestId('upload-stats')).toContainText('chunk')
  await expect(row.getByRole('progressbar')).toBeVisible()
  // the pipeline checklist follows job stage events, then the key-less ASR failure is actionable
  await expect(row.getByTestId('failure-notice')).toBeVisible({ timeout: 60_000 })
  await expect(row.getByTestId('failure-notice')).toHaveAttribute('data-code', 'ASR_UNAVAILABLE')
  await expect(row.getByTestId('failure-notice')).toContainText('Attach one you already have')
  expect(chunks).toBeGreaterThan(1)
  await row.getByTestId('transcript-file').setInputFiles(clip.words)
  await expect(row.getByTestId('upload-ready')).toBeVisible({ timeout: 90_000 })
  const assets = (await apiGet<{ items: Asset[] }>(request, '/assets')).items
  const mine = assets.find((a) => a.filename.startsWith('clip-'))!
  expect(mine.status).toBe('ready')
  // same bytes again: the server reports a duplicate and the UI says so
  await row.getByRole('button', { name: /^Remove/ }).click()
  await page.getByTestId('upload-input').setInputFiles(clip.video)
  await expect(page.getByTestId('upload-duplicate')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await page.reload()
  await expect(page.getByTestId('asset-card').filter({ hasText: 'clip-' }).locator('.prov').first()).toBeVisible()
})

test('an upload can be canceled', async ({ page }) => {
  const clip = makeDemoClip(`cancel-${Date.now()}`)
  await login(page)
  await page.goto('/assets')
  await page.route('**/api/v1/uploads/*/chunks/*', async (route) => {
    await new Promise((r) => setTimeout(r, 4000))
    await route.continue().catch(() => undefined)
  })
  await page.getByTestId('open-upload').click()
  await page.getByTestId('upload-input').setInputFiles(clip.video)
  const row = page.getByTestId('upload-row').first()
  await expect(row).toHaveAttribute('data-phase', 'uploading')
  await row.getByTestId('abort-upload').click()
  await expect(row).toHaveAttribute('data-phase', 'aborted')
})

test('deleting an asset asks for confirmation', async ({ page, request }) => {
  const mine = (await apiGet<{ items: Asset[] }>(request, '/assets')).items.find((a) => a.filename.startsWith('clip-') && a.status === 'ready')!
  await login(page)
  await page.goto(`/assets?asset=${mine.id}`)
  await page.getByRole('button', { name: 'Details' }).click()
  await page.getByTestId('delete-asset').click()
  await expect(page.getByText(/This removes the file/)).toBeVisible()
  await page.getByRole('button', { name: 'Delete asset' }).click()
  await expect(page.getByTestId('asset-drawer')).toHaveCount(0)
  await expect.poll(async () => (await apiGet<{ items: Asset[] }>(request, '/assets')).items.some((a) => a.id === mine.id)).toBe(false)
})
