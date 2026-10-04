import { expect, test } from '@playwright/test'
import { API, apiGet, authHeaders, login } from './helpers'

/**
 * Smart Clips > From YouTube against the real API.
 *
 * The first test runs everywhere (no network): the form adapts to what is configured and refuses bad links.
 * The second is the whole real pipeline and needs the internet, a web search key and speech-to-text on the API
 * (run it against a dev stack: `E2E_YOUTUBE=1 E2E_WEB_URL=http://localhost:3000 E2E_API_URL=http://localhost:8000
 * E2E_EMAIL=... E2E_PASSWORD=... npm run e2e -- --project=keyless youtube-import`). Nothing is stubbed: Serper finds the
 * videos, yt-dlp downloads one from YouTube, Whisper transcribes it, the embedder indexes it and Smart Clips cuts it.
 */
test.describe.configure({ mode: 'serial' })

type Status = { available: boolean; search_configured: boolean; asr_available: boolean }
type Import = { id: string; status: string; error: string | null; content_item_id: string; asset_id: string; clips_count: number; transcript_source: string | null }

test('the form adapts to the setup and refuses links that are not YouTube videos', async ({ page, request }) => {
  const status = await apiGet<Status>(request, '/yt-import/status')
  expect(status.available).toBe(true)
  await login(page)
  await page.goto('/smart-clips?tab=youtube')
  await expect(page.getByTestId('yt-form')).toBeVisible()
  if (status.search_configured) {
    await expect(page.getByTestId('yt-topic')).toBeEnabled()
  } else {
    // honest setup state: topic search says which key is missing, pasting a link is the default
    await page.getByRole('button', { name: 'Search a topic' }).click()
    await expect(page.getByTestId('yt-topic')).toBeDisabled()
    await expect(page.getByText(/SERPER_API_KEY/)).toBeVisible()
  }
  await page.getByRole('button', { name: 'Paste a link' }).click()
  const go = page.getByTestId('yt-import-link')
  await expect(go).toBeDisabled()
  await page.getByTestId('yt-url').fill('https://vimeo.com/123456')
  await expect(go).toBeDisabled()
  await page.getByTestId('yt-url').fill('https://www.youtube.com/@somechannel')
  await expect(go).toBeDisabled()
  await page.getByTestId('yt-url').fill('https://youtu.be/jNQXAC9IVRw')
  await expect(go).toBeEnabled()
  // the API refuses anything that is not a single YouTube video too
  const res = await request.post(`${API}/api/v1/yt-import`, { headers: await authHeaders(request), data: { url: 'http://127.0.0.1:8000/api/v1/health' } })
  expect(res.status()).toBe(422)
})

test('a topic search finds a video that is downloaded, transcribed, indexed and cut into clips', async ({ page, request }) => {
  test.skip(!process.env.E2E_YOUTUBE, 'needs the network: set E2E_YOUTUBE=1 and run against a stack with a search key and ASR')
  test.setTimeout(12 * 60_000)
  const status = await apiGet<Status>(request, '/yt-import/status')
  expect(status.search_configured && status.asr_available).toBe(true)

  await login(page)
  await page.goto('/smart-clips?tab=youtube')
  await page.getByTestId('yt-topic').fill('how to stop saying um in 60 seconds')
  await page.getByTestId('yt-search').click()
  const results = page.getByTestId('yt-result')
  await expect(results.first()).toBeVisible({ timeout: 30_000 })
  // thumbnails come through the API (no remote images in the page)
  await expect(results.first().locator('img')).toHaveAttribute('src', /\/api\/v1\/yt-import\/thumbnail\//)
  const pick = results.filter({ has: page.getByTestId('yt-import').and(page.locator(':enabled')) }).first()
  await pick.getByTestId('yt-import').click()

  const view = page.getByTestId('yt-import-view')
  await expect(view).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('yt-progress')).toBeVisible()
  await expect(view).toHaveAttribute('data-status', /done|failed/, { timeout: 11 * 60_000 })
  await expect(view).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('yt-transcript-source')).toContainText('Whisper')
  await expect(page.getByTestId('yt-clips').getByTestId('clip-card').first()).toBeVisible({ timeout: 30_000 })

  const rows = await apiGet<Import[]>(request, '/yt-import')
  const row = rows[0]
  expect(row.status).toBe('done')
  expect(row.transcript_source).toBe('asr')
  expect(row.clips_count).toBeGreaterThan(0)
  // the video is a normal, searchable library asset of the new project
  const asset = await apiGet<{ status: string; content_item_id: string; segments: unknown[] }>(request, `/assets/${row.asset_id}`)
  expect(asset.status).toBe('ready')
  expect(asset.content_item_id).toBe(row.content_item_id)
  expect(asset.segments.length).toBeGreaterThan(0)
  const clips = await apiGet<{ kind: string; source_asset_id: string }[]>(request, `/content/${row.content_item_id}/clips`)
  expect(clips.filter((c) => c.kind === 'short' && c.source_asset_id === row.asset_id).length).toBe(row.clips_count)

  await page.getByTestId('yt-open-project').click()
  await page.waitForURL(`**/projects/${row.content_item_id}/clips`)
  await expect(page.getByTestId('clip-card').first()).toBeVisible()
})
