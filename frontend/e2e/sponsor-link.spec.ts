import { expect, test } from '@playwright/test'
import { API, apiGet, authHeaders, heroId, login } from './helpers'

type Video = { id: string; kind: string; asset_id: string | null; placeholder: boolean; src_out: number }
type EditOut = { revision: number; timeline: { duration: number; tracks: { video: Video[] } } }

test('editor: a sponsor placeholder becomes the recorded segment', async ({ page, request }) => {
  const hero = await heroId(request)
  const clip = (await apiGet<{ id: string; kind: string }[]>(request, `/content/${hero}/clips`)).find((c) => c.kind === 'short')!
  const assets = await apiGet<{ items: { id: string; kind: string; status: string; duration_sec: number }[] }>(request, `/assets?content_item_id=${hero}&kind=video&status=ready`)
  const recording = assets.items[0]
  const before = await apiGet<EditOut>(request, `/clips/${clip.id}/edit`)
  const res = await request.post(`${API}/api/v1/clips/${clip.id}/edit/ops`, {
    headers: await authHeaders(request),
    data: {
      op: 'ripple_insert',
      base_revision: before.revision,
      params: { at_tl: 1, item: { id: 'v_e2esponsor', source: 'ai', status: 'suggested', kind: 'sponsor', asset_id: null, placeholder: true, src_in: 0, src_out: 6, tl_start: 0, text: 'Sponsor read for Acme' } },
    },
  })
  expect(res.ok(), await res.text()).toBeTruthy()

  await login(page)
  await page.goto(`/editor/${clip.id}`)
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved')
  await page.getByTestId('tl-video-item').filter({ hasText: 'Sponsor placeholder' }).click()
  await expect(page.getByTestId('link-recording')).toBeVisible()
  await page.getByTestId('link-recording-asset').selectOption(recording.id)
  await page.getByTestId('link-recording-apply').click()
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
  await expect
    .poll(async () => (await apiGet<EditOut>(request, `/clips/${clip.id}/edit`)).timeline.tracks.video.find((v) => v.id === 'v_e2esponsor')?.placeholder)
    .toBe(false)
  const after = await apiGet<EditOut>(request, `/clips/${clip.id}/edit`)
  const item = after.timeline.tracks.video.find((v) => v.id === 'v_e2esponsor')!
  expect(item.asset_id).toBe(recording.id)
  expect(item.src_out).toBeCloseTo(recording.duration_sec, 1)
})
