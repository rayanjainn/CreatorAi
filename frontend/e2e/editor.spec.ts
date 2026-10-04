import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API, apiGet, authHeaders, heroId, login } from './helpers'

/**
 * The clip editor against the real stack: timeline from the API, edit operations, autosave (verified through the API's
 * revision counter), AI layer decisions in the activity log, revisions, REVISION_CONFLICT, export and the clock-driven
 * transport. Playwright's Chromium cannot decode H.264, so playback assertions use the timecode and playhead.
 */
test.describe.configure({ mode: 'serial' })

type Item = { id: string; status: string; source: string; src_in: number; src_out: number; tl_start: number; crop_x: number; asset_id: string }
type Timeline = {
  aspect: string
  duration: number
  caption_style: string
  tracks: { video: Item[]; captions: { id: string; text: string; status: string; source: string }[]; audio: { id: string; kind: string; asset_id: string; status: string }[]; overlays: { id: string; kind: string; text: string }[] }
}
type EditOut = { revision: number; timeline: Timeline }
type Clip = { id: string; title: string; content_item_id: string; edit_revision: number }

let hero = ''
let clips: Clip[] = []
let audioAssetId: string | null = null

const edit = (request: APIRequestContext, clipId: string) => apiGet<EditOut>(request, `/clips/${clipId}/edit`)
const activeVideo = (t: Timeline) => t.tracks.video.filter((v) => v.status !== 'rejected')

async function open(page: Page, clipId: string) {
  await page.goto(`/editor/${clipId}`)
  await expect(page.getByTestId('timeline')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved')
}
const saved = (page: Page) => expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
const videoItems = (page: Page) => page.getByTestId('tl-video-item')

/** Seek by whole seconds with the keyboard (Home, then Shift+Right). */
async function seek(page: Page, seconds: number) {
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Home')
  for (let i = 0; i < seconds; i++) await page.keyboard.press('Shift+ArrowRight')
}

/** Put the playhead inside a timeline item by clicking the ruler above it. */
async function seekInto(page: Page, item: ReturnType<Page['locator']>) {
  const ib = (await item.boundingBox())!
  const rb = (await page.getByTestId('ruler').boundingBox())!
  await page.mouse.click(ib.x + Math.min(12, ib.width / 2), rb.y + 14)
}

test.beforeAll(async ({ request }) => {
  hero = await heroId(request)
  clips = (await apiGet<Clip[]>(request, `/content/${hero}/clips`)).filter((c) => (c as unknown as { kind: string }).kind === 'short')
  expect(clips.length).toBeGreaterThanOrEqual(2)
})

test.afterAll(async ({ request }) => {
  // the library spec expects no audio asset; leave nothing behind
  if (audioAssetId) await request.delete(`${API}/api/v1/assets/${audioAssetId}`, { headers: await authHeaders(request) })
})

test('the timeline renders the real tracks, layer badges and revision from the API', async ({ page, request }) => {
  const api = await edit(request, clips[0].id)
  await login(page)
  await open(page, clips[0].id)
  await expect(page.getByTestId('editor-header')).toContainText('Clip editor')
  await expect(videoItems(page)).toHaveCount(activeVideo(api.timeline).length)
  await expect(page.getByTestId('tl-caption-item')).toHaveCount(api.timeline.tracks.captions.length)
  await expect(page.getByTestId('revision-number')).toHaveText(String(api.revision))
  await expect(page.getByTestId('timeline-duration')).toContainText(':')
  // the agent's layers carry the yellow Agent chip with a state; hovering shows the reason
  const badge = videoItems(page).first().getByTestId('layer-badge')
  await expect(badge).toHaveAttribute('data-source', 'ai')
  await expect(badge).toHaveAttribute('data-status', 'suggested')
  await badge.hover()
  await expect(page.getByText('Made by the Agent').first()).toBeVisible()
  // track labels, lock and mute controls, left panel and honest Twin card
  for (const t of ['overlays', 'captions', 'video', 'audio']) await expect(page.getByTestId(`lock-${t}`)).toBeVisible()
  await expect(page.getByTestId('twin-unavailable')).toContainText("isn't available yet")
  await expect(page.getByTestId('history-panel').getByTestId('layer-group')).toHaveCount(2) // video cuts + captions
  await expect(page.getByTestId('monitor-frame')).toHaveAttribute('data-aspect', api.timeline.aspect)
  // the demo clip's title carries the Demo + Heuristic provenance badges
  await expect(page.getByTestId('editor-header').locator('.prov[data-source=demo]')).toBeVisible()
})

test('select, split, undo, redo and delete; every change autosaves a server revision', async ({ page, request }) => {
  const id = clips[0].id
  const start = await edit(request, id)
  const n0 = activeVideo(start.timeline).length
  await login(page)
  await open(page, id)
  // select: click a clip; the inspector shows its range and the Agent's reason
  await videoItems(page).first().click()
  await expect(page.getByTestId('inspector-video')).toBeVisible()
  await expect(page.getByTestId('item-reason')).toContainText('Top-scoring window')
  // split at 1 s (S): one more clip, autosaved as the next revision, and the server accepted the timeline
  await seek(page, 1)
  await page.keyboard.press('s')
  await expect(videoItems(page)).toHaveCount(n0 + 1)
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', /unsaved|saving/)
  await saved(page)
  let api = await edit(request, id)
  expect(api.revision).toBe(start.revision + 1)
  expect(activeVideo(api.timeline).length).toBe(n0 + 1)
  expect(Math.abs(api.timeline.duration - start.timeline.duration)).toBeLessThan(0.01) // a split moves nothing
  // undo / redo through the shortcut and the toolbar
  await page.keyboard.press('Control+z')
  await expect(videoItems(page)).toHaveCount(n0)
  await saved(page)
  expect(activeVideo((await edit(request, id)).timeline).length).toBe(n0)
  await page.getByTestId('tool-redo').click()
  await expect(videoItems(page)).toHaveCount(n0 + 1)
  await saved(page)
  api = await edit(request, id)
  expect(api.revision).toBe(start.revision + 3)
  // delete the second clip: ripple keeps the video gapless (the server validates it on save)
  await videoItems(page).nth(1).click()
  const lenBefore = api.timeline.duration
  await page.keyboard.press('Delete')
  await expect(videoItems(page)).toHaveCount(n0)
  await saved(page)
  api = await edit(request, id)
  expect(activeVideo(api.timeline).length).toBe(n0)
  expect(api.timeline.duration).toBeLessThan(lenBefore)
  const v = activeVideo(api.timeline)
  for (let i = 1; i < v.length; i++) expect(v[i].tl_start).toBeCloseTo(v[i - 1].tl_start + (v[i - 1].src_out - v[i - 1].src_in), 2)
  // the toast offers Undo
  await page.getByRole('button', { name: 'Undo' }).last().click()
  await expect(videoItems(page)).toHaveCount(n0 + 1)
  await saved(page)
})

test('trim: numeric fields and drag handles ripple the clips and save', async ({ page, request }) => {
  const id = clips[0].id
  await login(page)
  await open(page, id)
  const before = await edit(request, id)
  const first = activeVideo(before.timeline)[0]
  // numeric out point through the inspector
  await videoItems(page).first().click()
  await page.getByTestId('out-field').fill(String(first.src_out - 0.5))
  await page.getByTestId('out-field').press('Enter')
  await saved(page)
  let api = await edit(request, id)
  expect(activeVideo(api.timeline)[0].src_out).toBeCloseTo(first.src_out - 0.5, 2)
  expect(api.timeline.duration).toBeCloseTo(before.timeline.duration - 0.5, 1)
  // drag the end handle of the second clip to the left
  const item = videoItems(page).nth(1)
  await item.click()
  const second = activeVideo(api.timeline)[1]
  const handle = item.getByTestId('trim-end')
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 30, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await saved(page)
  api = await edit(request, id)
  expect(activeVideo(api.timeline)[1].src_out).toBeLessThan(second.src_out - 0.1)
  // trim tool + "trim start to playhead" keeps the source range valid
  await page.getByTestId('tool-trim').click()
  await expect(page.getByTestId('tool-trim')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('tool-select').click()
})

test('reordering clips by dragging keeps the cut gapless and saves', async ({ page, request }) => {
  const id = clips[0].id
  await login(page)
  await open(page, id)
  const before = activeVideo((await edit(request, id)).timeline)
  const a = videoItems(page).nth(0)
  const b = videoItems(page).nth(2)
  const ba = (await a.boundingBox())!
  const bb = (await b.boundingBox())!
  await page.mouse.move(bb.x + 60, bb.y + 28)
  await page.mouse.down()
  await page.mouse.move(bb.x + 30, bb.y + 28, { steps: 4 })
  await page.mouse.move(ba.x + 6, ba.y + 28, { steps: 14 })
  await expect(page.locator('.tl-drop')).toBeVisible()
  await page.mouse.up()
  await saved(page)
  const after = activeVideo((await edit(request, id)).timeline)
  expect(after[0].id).toBe(before[2].id)
  expect(after.map((v) => v.id).sort()).toEqual(before.map((v) => v.id).sort())
  for (let i = 1; i < after.length; i++) expect(after[i].tl_start).toBeCloseTo(after[i - 1].tl_start + (after[i - 1].src_out - after[i - 1].src_in), 2)
})

test('caption style: the monitor follows and the project style is saved; per-caption override', async ({ page, request }) => {
  const id = clips[0].id
  await login(page)
  await open(page, id)
  await seekInto(page, page.getByTestId('tl-caption-item').first())
  await page.getByTestId('inspector-tab-project').click()
  await page.getByRole('group', { name: 'Caption style' }).getByRole('button', { name: 'Minimal bottom' }).click()
  await expect(page.getByTestId('monitor-caption').first()).toHaveAttribute('data-style', 'minimal_bottom')
  await saved(page)
  expect((await edit(request, id)).timeline.caption_style).toBe('minimal_bottom')
  await page.getByRole('group', { name: 'Caption style' }).getByRole('button', { name: 'Karaoke' }).click()
  await expect(page.getByTestId('monitor-caption').first()).toHaveAttribute('data-style', 'karaoke')
  await saved(page)
  // one caption keeps its own look
  await page.getByTestId('tl-caption-item').first().click()
  await page.getByTestId('style-override').selectOption('bold_center')
  await saved(page)
  expect((await edit(request, id)).timeline.tracks.captions.some((c) => (c as unknown as { style_override: string }).style_override === 'bold_center')).toBe(true)
  await page.getByTestId('inspector-tab-project').click()
  await page.getByRole('group', { name: 'Caption style' }).getByRole('button', { name: 'Bold center' }).click()
  await saved(page)
})

test('editing a caption, regenerating captions and the server tighten-pauses op', async ({ page, request }) => {
  const id = clips[0].id
  await login(page)
  await open(page, id)
  await page.getByTestId('tl-caption-item').nth(1).click()
  await page.getByTestId('caption-text').fill('Edited by the e2e')
  await page.getByTestId('caption-text').blur()
  await saved(page)
  expect((await edit(request, id)).timeline.tracks.captions.map((c) => c.text)).toContain('Edited by the e2e')
  // regenerate with the local caption rules (asks first because captions exist)
  await page.getByTestId('inspector-tab-project').click()
  await page.getByTestId('regenerate-captions').click()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await saved(page)
  const api = await edit(request, id)
  expect(api.timeline.tracks.captions.map((c) => c.text)).not.toContain('Edited by the e2e')
  expect(api.timeline.tracks.captions.every((c) => c.source === 'ai' && c.status === 'suggested')).toBe(true)
  // tighten pauses runs on the server and saves a revision with its own note
  const rev = api.revision
  await page.getByTestId('tighten-pauses').click()
  await expect(page.getByTestId('revision-number')).toHaveText(String(rev + 1), { timeout: 15_000 })
  const revs = await apiGet<{ revision: number; note: string }[]>(request, `/clips/${id}/edit/revisions`)
  expect(revs[0].note).toBe('Tightened pauses')
  await saved(page)
})

test('accepting and rejecting AI layers is logged as layer_accepted / layer_rejected', async ({ page, request }) => {
  const id = clips[0].id
  await login(page)
  await open(page, id)
  await page.getByTestId('tl-caption-item').first().click()
  await page.getByTestId('reject-item').click()
  await expect(page.getByTestId('tl-caption-item').first()).toHaveAttribute('data-status', 'rejected')
  await saved(page)
  type Act = { action: string; meta: { clip_id: string; layer: string; count: number; sources: string[] } }
  let acts = (await apiGet<{ items: Act[] }>(request, '/activity?action=layer_rejected&entity_type=clip&limit=50')).items.filter((a) => a.meta.clip_id === id)
  expect(acts.length).toBeGreaterThanOrEqual(1)
  expect(acts[0].meta).toMatchObject({ layer: 'captions', count: 1, sources: ['ai'] })
  // the left panel lists it
  await expect(page.getByTestId('activity').getByTestId('activity-row').first()).toContainText('Rejected 1 Agent caption')
  // accept the whole group from the checklist (this also restores the rejected one)
  await page.getByTestId('history-panel').locator('[data-kind=captions]').getByTestId('group-accept').click()
  await saved(page)
  acts = (await apiGet<{ items: Act[] }>(request, '/activity?action=layer_accepted&entity_type=clip&limit=50')).items.filter((a) => a.meta.clip_id === id)
  expect(acts.some((a) => a.meta.layer === 'captions')).toBe(true)
  // rejecting a video clip takes no time on the timeline; "Accept all" in the header accepts what is left
  const api = await edit(request, id)
  const n = activeVideo(api.timeline).length
  await videoItems(page).nth(1).click()
  await page.getByTestId('reject-item').click()
  await expect(videoItems(page)).toHaveCount(n - 1)
  await expect(page.getByTestId('tl-rejected-video')).toHaveCount(1)
  await saved(page)
  const after = await edit(request, id)
  expect(activeVideo(after.timeline).length).toBe(n - 1)
  expect(after.timeline.tracks.video.some((v) => v.status === 'rejected')).toBe(true)
  await page.getByTestId('tl-rejected-video').click()
  await page.getByTestId('accept-item').click() // Restore
  await expect(videoItems(page)).toHaveCount(n)
  await page.getByTestId('accept-all').click()
  await saved(page)
  const final = await edit(request, id)
  expect(final.timeline.tracks.video.every((v) => v.status === 'accepted')).toBe(true)
})

test('overlays, library audio and track locks', async ({ page, request }) => {
  // an audio asset with a sidecar transcript so processing needs no ASR
  const dir = join(tmpdir(), 'creatorai-e2e-audio')
  mkdirSync(dir, { recursive: true })
  const mp3 = join(dir, `e2e-tone-${Date.now()}.mp3`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-c:a', 'libmp3lame', '-b:a', '64k', mp3])
  const words = mp3.replace('.mp3', '.words.json')
  writeFileSync(words, JSON.stringify([{ word: 'tone', start: 0.5, end: 0.9 }]))
  const up = await request.post(`${API}/api/v1/assets/upload`, {
    headers: await authHeaders(request),
    multipart: { file: { name: 'e2e-tone.mp3', mimeType: 'audio/mpeg', buffer: readFileSync(mp3) }, sidecar: { name: 'e2e-tone.words.json', mimeType: 'application/json', buffer: readFileSync(words) } },
  })
  expect(up.ok()).toBeTruthy()
  audioAssetId = (await up.json()).asset.id
  await expect.poll(async () => (await apiGet<{ status: string }>(request, `/assets/${audioAssetId}`)).status, { timeout: 60_000 }).toBe('ready')

  const id = clips[0].id
  await login(page)
  await open(page, id)
  await seek(page, 2)
  await page.getByTestId('tool-text').click()
  await expect(page.getByTestId('tl-overlay-item')).toHaveCount(1)
  await expect(page.getByTestId('inspector-overlay')).toBeVisible()
  await page.getByTestId('overlay-text').fill('Hello e2e')
  await page.getByTestId('overlay-text').blur()
  await expect(page.getByTestId('monitor-overlay').first()).toContainText('Hello e2e')
  // restyle: font, colour, then drag the text on the preview
  await page.getByTestId('text-font').selectOption('serif')
  await page.getByTestId('text-color').fill('#ff4d6d')
  const box = page.getByTestId('monitor-overlay').first()
  const before = (await box.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 120, { steps: 8 })
  await page.mouse.up()
  const after = (await box.boundingBox())!
  expect(after.y).toBeGreaterThan(before.y + 80)
  await expect(box).toHaveCSS('color', 'rgb(255, 77, 109)')
  await page.getByTestId('tool-lower-third').click()
  await saved(page)
  let api = await edit(request, id)
  const styled = api.timeline.tracks.overlays.find((o) => o.kind === 'text') as unknown as { style: { font: string; color: string; y: number } }
  expect(styled.style.font).toBe('serif')
  expect(styled.style.color.toLowerCase()).toBe('#ff4d6d')
  expect(styled.style.y).toBeGreaterThan(0.3)
  expect(api.timeline.tracks.overlays.map((o) => o.kind).sort()).toEqual(['lower_third', 'text'])
  expect(api.timeline.tracks.overlays.some((o) => o.text === 'Hello e2e')).toBe(true)
  // your own layers carry the orange "You" chip and are accepted
  await expect(page.getByTestId('tl-overlay-item').first().getByTestId('layer-badge')).toHaveAttribute('data-source', 'user')
  // add the uploaded audio as music from the picker
  await page.getByTestId('tool-audio').click()
  const option = page.getByTestId('audio-option').filter({ hasText: 'e2e-tone.mp3' })
  await expect(option).toBeVisible()
  await option.getByTestId('add-audio-asset').click()
  await expect(page.getByTestId('tl-audio-item')).toHaveCount(1)
  await expect(page.getByTestId('tl-audio-item').locator('svg.wave rect').first()).toBeAttached() // waveform from the energy curve
  await page.getByTestId('gain-slider').focus()
  await page.keyboard.press('ArrowRight')
  await saved(page)
  api = await edit(request, id)
  const audio = api.timeline.tracks.audio.filter((a) => a.asset_id === audioAssetId)
  expect(audio).toHaveLength(1)
  expect(audio[0].kind).toBe('music')
  // lock the video track: edits are refused with a hint
  const n = videoItems(page)
  const count = await n.count()
  await page.getByTestId('lock-video').click()
  await seek(page, 1)
  await page.keyboard.press('s')
  await expect(page.getByText('The video track is locked')).toBeVisible()
  await expect(videoItems(page)).toHaveCount(count)
  await page.getByTestId('lock-video').click()
  // delete the overlays and the audio again (plain delete, nothing ripples)
  await page.getByTestId('tl-overlay-item').first().click()
  await page.keyboard.press('Delete')
  await page.getByTestId('tl-overlay-item').first().click()
  await page.keyboard.press('Delete')
  await page.getByTestId('tl-audio-item').first().click()
  await page.keyboard.press('Delete')
  await saved(page)
  api = await edit(request, id)
  expect(api.timeline.tracks.overlays).toHaveLength(0)
  expect(api.timeline.tracks.audio.filter((a) => a.asset_id === audioAssetId)).toHaveLength(0)
})

test('revision history: preview an old revision read-only, then restore it as a new revision', async ({ page, request }) => {
  const id = clips[0].id
  await login(page)
  await open(page, id)
  const revs = await apiGet<{ revision: number }[]>(request, `/clips/${id}/edit/revisions`)
  const latest = revs[0].revision
  const oldest = revs[revs.length - 1].revision
  const oldTl = (await apiGet<{ timeline: Timeline }>(request, `/clips/${id}/edit/revisions/${oldest}`)).timeline
  await page.getByTestId('revision-menu').click()
  const row = page.getByTestId('revision-row').filter({ hasText: new RegExp(`Rev ${oldest}(?!\\d)`) }).first()
  await row.getByTestId('preview-revision').click()
  await expect(page.getByTestId('preview-banner')).toContainText(`revision ${oldest}`)
  await expect(page.getByTestId('save-status')).toContainText('Previewing')
  await expect(videoItems(page)).toHaveCount(activeVideo(oldTl).length)
  await page.getByTestId('preview-back').click()
  await expect(page.getByTestId('preview-banner')).toHaveCount(0)
  await page.getByTestId('revision-menu').click()
  await page.getByTestId('revision-row').filter({ hasText: new RegExp(`Rev ${oldest}(?!\\d)`) }).first().getByTestId('restore-revision').click()
  await expect(page.getByTestId('revision-number')).toHaveText(String(latest + 1), { timeout: 15_000 })
  const api = await edit(request, id)
  expect(api.revision).toBe(latest + 1)
  expect(api.timeline.tracks.video.map((v) => v.id)).toEqual(oldTl.tracks.video.map((v) => v.id))
  expect((await apiGet<{ revision: number; note: string }[]>(request, `/clips/${id}/edit/revisions`))[0].note).toBe(`Restored revision ${oldest}`)
})

test('REVISION_CONFLICT: reload, safe merge and refusal', async ({ page, request }) => {
  const id = clips[1].id
  const h = await authHeaders(request)
  await login(page)
  await open(page, id)
  // 1. another writer changes the caption style; I split a clip (re-cuts the video): merging is refused, reload is offered
  let cur = await edit(request, id)
  const op1 = await request.post(`${API}/api/v1/clips/${id}/edit/ops`, { headers: h, data: { op: 'set_caption_style', params: { style: 'minimal_bottom' }, base_revision: cur.revision } })
  expect(op1.ok()).toBeTruthy()
  const n = await videoItems(page).count()
  await seek(page, 1)
  await page.keyboard.press('s')
  await expect(page.getByTestId('conflict-dialog')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('conflict-current')).toHaveText(String(cur.revision + 1))
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'conflict')
  await expect(page.getByTestId('conflict-rebase')).toBeDisabled()
  await expect(page.getByTestId('conflict-dialog')).toContainText('re-cut the video')
  const stale = await edit(request, id)
  expect(stale.revision).toBe(cur.revision + 1) // nothing was saved behind their back
  await page.getByTestId('conflict-reload').click()
  await expect(page.getByTestId('conflict-dialog')).toHaveCount(0)
  await expect(videoItems(page)).toHaveCount(n) // my split is gone: reload keeps nothing silently
  await expect(page.getByTestId('revision-number')).toHaveText(String(cur.revision + 1))
  await saved(page)
  // 2. a change to a different layer than theirs can be merged
  cur = await edit(request, id)
  const op2 = await request.post(`${API}/api/v1/clips/${id}/edit/ops`, { headers: h, data: { op: 'set_caption_style', params: { style: 'karaoke' }, base_revision: cur.revision } })
  expect(op2.ok()).toBeTruthy()
  await page.getByTestId('tl-caption-item').nth(2).click()
  await page.getByTestId('caption-text').fill('Mine after the conflict')
  await page.getByTestId('caption-text').blur()
  await expect(page.getByTestId('conflict-dialog')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('conflict-rebase')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('conflict-rebase').click()
  await expect(page.getByTestId('conflict-dialog')).toHaveCount(0)
  await saved(page)
  const merged = await edit(request, id)
  expect(merged.revision).toBe(cur.revision + 2)
  expect(merged.timeline.caption_style).toBe('karaoke') // theirs kept
  expect(merged.timeline.tracks.captions.map((c) => c.text)).toContain('Mine after the conflict') // mine kept
  // 3. overwrite: my version becomes a new revision, theirs stays in history
  const op3 = await request.post(`${API}/api/v1/clips/${id}/edit/ops`, { headers: h, data: { op: 'set_caption_style', params: { style: 'bold_center' }, base_revision: merged.revision } })
  expect(op3.ok()).toBeTruthy()
  await page.getByTestId('tl-caption-item').nth(2).click()
  await page.getByTestId('caption-text').fill('Mine overwrites')
  await page.getByTestId('caption-text').blur()
  await expect(page.getByTestId('conflict-dialog')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('conflict-overwrite').click()
  await expect(page.getByTestId('conflict-dialog')).toHaveCount(0)
  await saved(page)
  const over = await edit(request, id)
  expect(over.revision).toBe(merged.revision + 2)
  expect(over.timeline.tracks.captions.map((c) => c.text)).toContain('Mine overwrites')
  const history = await apiGet<{ revision: number }[]>(request, `/clips/${id}/edit/revisions`)
  expect(history.some((r) => r.revision === merged.revision + 1)).toBe(true) // theirs is still restorable
})

test('transport: clock-driven playback, frame stepping, timecode and the honest decode notice', async ({ page }) => {
  await login(page)
  await open(page, clips[0].id)
  const tc = page.getByTestId('timecode')
  await expect(tc).toHaveText('00:00:00:00')
  await page.getByTestId('play-toggle').click()
  await expect(page.getByTestId('play-toggle')).toHaveAttribute('data-playing', 'true')
  await expect.poll(async () => Number(await page.getByTestId('playhead').getAttribute('data-time')), { timeout: 8000 }).toBeGreaterThan(1.2)
  await page.keyboard.press('Space') // pause
  await expect(page.getByTestId('play-toggle')).toHaveAttribute('data-playing', 'false')
  const paused = await tc.textContent()
  await page.waitForTimeout(400)
  expect(await tc.textContent()).toBe(paused) // stopped
  await page.getByTestId('frame-forward').click()
  const t1 = Number(await page.getByTestId('playhead').getAttribute('data-time'))
  await page.getByTestId('frame-forward').click()
  const t2 = Number(await page.getByTestId('playhead').getAttribute('data-time'))
  expect(t2 - t1).toBeCloseTo(1 / 30, 2)
  await page.getByTestId('frame-back').click()
  expect(Number(await page.getByTestId('playhead').getAttribute('data-time'))).toBeCloseTo(t1, 2)
  await page.getByTestId('go-end').click()
  await expect(page.getByTestId('timecode')).toHaveText(await page.getByTestId('timecode-total').textContent() as string)
  await page.getByTestId('go-start').click()
  await expect(tc).toHaveText('00:00:00:00')
  // clicking the ruler moves the playhead; the monitor shows the captions live at that time
  const ruler = page.getByTestId('ruler')
  const rb = (await ruler.boundingBox())!
  await page.mouse.click(rb.x + 152 + 140, rb.y + 14)
  expect(Number(await page.getByTestId('playhead').getAttribute('data-time'))).toBeGreaterThan(0.5)
  // this Chromium has no H.264: the monitor says so instead of showing a blank frame (Chrome plays it)
  await page.getByTestId('go-start').click()
  await page.getByTestId('play-toggle').click()
  await expect(page.getByTestId('engine-notice')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('engine-notice')).toContainText('clock-driven')
  await page.keyboard.press('Space')
  // zoom changes the timeline scale
  const w0 = (await videoItems(page).first().boundingBox())!.width
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  expect((await videoItems(page).first().boundingBox())!.width).toBeGreaterThan(w0 * 1.5)
  await page.getByTestId('zoom-fit').click()
  // preview mode hides the panels and the timeline, the shortcuts popover lists the keys
  await page.getByTestId('mode-preview').click()
  await expect(page.getByTestId('timeline')).toHaveCount(0)
  await expect(page.getByTestId('monitor')).toBeVisible()
  await page.getByTestId('mode-edit').click()
  await expect(page.getByTestId('timeline')).toBeVisible()
  await page.getByTestId('shortcuts-button').click()
  await expect(page.getByTestId('shortcuts')).toContainText('Split the clip at the playhead')
})

test('export opens the render dialog, a render completes, then a newer edit shows the stale-render hint', async ({ page, request }) => {
  const id = clips[1].id
  await login(page)
  await open(page, id)
  await page.getByTestId('editor-export').click()
  await expect(page.getByTestId('preset-yt_short')).toBeVisible()
  await page.getByTestId('preset-yt_short').click()
  await page.getByTestId('start-render').click()
  await expect(page.getByTestId('render-result')).toHaveAttribute('data-status', 'done', { timeout: 120_000 })
  await expect(page.getByTestId('download-render')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).last().click()
  const renders = await apiGet<{ id: string; edit_revision: number }[]>(request, `/clips/${id}/renders`)
  expect(renders[0].edit_revision).toBe((await edit(request, id)).revision)
  await expect(page.getByTestId('stale-render-hint')).toHaveCount(0)
  // an edit after the render makes it out of date
  await page.getByTestId('tl-caption-item').first().click()
  await page.getByTestId('caption-text').fill('After the render')
  await page.getByTestId('caption-text').blur()
  await expect(page.getByTestId('stale-render-hint')).toBeVisible()
  await saved(page)
  await expect(page.getByTestId('stale-render-hint')).toBeVisible()
  // clean up: the project spec expects an empty renders list
  for (const r of renders) {
    await request.delete(`${API}/api/v1/renders/${r.id}`, { headers: await authHeaders(request) })
  }
})

test('rename the clip from the header', async ({ page, request }) => {
  const id = clips[0].id
  await login(page)
  await open(page, id)
  const old = (await apiGet<Clip>(request, `/clips/${id}`)).title
  await page.getByTestId('rename-clip').click()
  await page.getByTestId('clip-title-input').fill('Renamed in the editor')
  await page.getByTestId('clip-title-input').press('Enter')
  await expect(page.getByTestId('clip-title')).toContainText('Renamed in the editor')
  await expect.poll(async () => (await apiGet<Clip>(request, `/clips/${id}`)).title).toBe('Renamed in the editor')
  await page.getByTestId('rename-clip').click()
  await page.getByTestId('clip-title-input').fill(old)
  await page.getByTestId('clip-title-input').press('Enter')
  await expect.poll(async () => (await apiGet<Clip>(request, `/clips/${id}`)).title).toBe(old)
})

test('honest states: unknown clip, narrow screens, and no console errors in the editor', async ({ page }) => {
  const problems: string[] = []
  page.on('console', (m) => ['error'].includes(m.type()) && problems.push(m.text()))
  page.on('pageerror', (e) => problems.push(String(e)))
  await login(page)
  await page.goto('/editor/00000000-0000-0000-0000-000000000000')
  await expect(page.getByTestId('editor-error')).toContainText('does not exist')
  // narrow screen: notice, read-only summary and Export
  await page.setViewportSize({ width: 820, height: 900 })
  await page.goto(`/editor/${clips[0].id}`)
  await expect(page.getByTestId('editor-small-screen')).toContainText('larger screen')
  await expect(page.getByTestId('editor-small-screen')).toContainText('captions')
  await page.getByTestId('small-export').click()
  await expect(page.getByTestId('preset-yt_short')).toBeVisible()
  await page.keyboard.press('Escape')
  // back to a wide screen: the full editor, with a clean console and no hydration warnings
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/editor/${clips[0].id}`)
  await expect(page.getByTestId('timeline')).toBeVisible()
  await page.getByTestId('play-toggle').click()
  await page.waitForTimeout(600)
  await page.keyboard.press('Space')
  expect(problems.filter((p) => !/Failed to load resource|MEDIA_ELEMENT_ERROR|net::ERR/i.test(p))).toEqual([])
})
