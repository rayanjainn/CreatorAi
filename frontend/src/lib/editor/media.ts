/**
 * Media for the editor: library files you drag onto the timeline and files you drop from your computer.
 * Dropped files are uploaded to the library in `light` mode (no transcript or captions needed), so music, b-roll and stills are
 * usable in seconds and keep working without any AI key; each one is added to the timeline as soon as it is ready.
 */
import { useEffect } from 'react'
import { api, unwrap } from '@/lib/api/client'
import { qk } from '@/lib/api/hooks'
import { queryClient } from '@/lib/api/query-client'
import type { Asset, AssetDetail } from '@/lib/api/types'
import { enqueueUploads } from '@/lib/upload'
import { toast } from '@/stores/toasts'
import { useEditor } from '@/stores/editor'
import { useUploads } from '@/stores/uploads'
import type { AudioKind } from '@/lib/timeline'
import { addAudioLayer, addVideoAsset } from './actions'
import { assetToEditAsset } from './api'

export const MEDIA_DRAG_TYPE = 'application/x-creatorai-asset'
export const MEDIA_ACCEPT = 'video/*,audio/*,image/*'
const EDITOR_TAG = 'editor'
const POLL_MS = 900
const POLL_MAX = 220 // ~3 minutes

export type MediaDrag = { id: string; kind: string; name: string }
export type DropPlace = { at?: number }

export const isMediaFile = (f: File) => /^(video|audio|image)\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|heic)$/i.test(f.name)

export function startMediaDrag(e: React.DragEvent, a: Pick<Asset, 'id' | 'kind' | 'filename'>) {
  const payload: MediaDrag = { id: a.id, kind: a.kind, name: a.filename }
  e.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(payload))
  e.dataTransfer.setData('text/plain', a.filename)
  e.dataTransfer.effectAllowed = 'copy'
}

/** What a drag event carries: a library asset, files from the computer, or nothing we accept. */
export function readDrop(e: React.DragEvent | DragEvent): { asset?: MediaDrag; files: File[] } {
  const dt = e.dataTransfer
  if (!dt) return { files: [] }
  const raw = dt.getData(MEDIA_DRAG_TYPE)
  if (raw) {
    try {
      return { asset: JSON.parse(raw) as MediaDrag, files: [] }
    } catch {
      /* fall through to files */
    }
  }
  return { files: Array.from(dt.files ?? []).filter(isMediaFile) }
}

export function isMediaDrag(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer?.types ?? [])
  return types.includes(MEDIA_DRAG_TYPE) || types.includes('Files')
}

const audioKindFor = (name: string): AudioKind => (/sfx|effect|whoosh|click|hit|boom/i.test(name) ? 'sfx' : 'music')

/** Put one library asset on the timeline: audio on the audio track, video and images on the video track. */
export async function addAssetToTimeline(assetId: string, place: DropPlace = {}): Promise<boolean> {
  const s = useEditor.getState()
  if (s.preview || s.busy) {
    toast.info('Leave the preview first', 'Go back to the latest revision to edit.')
    return false
  }
  try {
    const detail = await queryClient.fetchQuery({
      queryKey: qk.asset(assetId),
      queryFn: () => unwrap(api.GET('/api/v1/assets/{asset_id}', { params: { path: { asset_id: assetId }, query: { include_energy: true } } })) as Promise<AssetDetail>,
      staleTime: 0,
    })
    if (detail.status === 'failed') {
      toast.error(`${detail.filename} could not be processed`, detail.error ?? 'Open it in the library to see why.')
      return false
    }
    if (detail.status !== 'ready') {
      toast.info(`${detail.filename} is still processing`, 'It will be added as soon as it is ready.')
      return waitThenAdd(assetId, place)
    }
    useEditor.getState().mergeAssets({ [assetId]: assetToEditAsset(detail) })
    if (detail.kind === 'audio') {
      addAudioLayer({ assetId, kind: audioKindFor(detail.filename), duration: detail.duration_sec ?? 0, at: place.at })
      return true
    }
    if (detail.kind === 'video' || detail.kind === 'image') return addVideoAsset({ assetId, kind: detail.kind, duration: detail.duration_sec, at: place.at })
    toast.info('That file type cannot go on the timeline', 'Use a video, an image or an audio file.')
    return false
  } catch (e) {
    toast.error('Could not add that file', e instanceof Error ? e.message : undefined)
    return false
  }
}

async function waitThenAdd(assetId: string, place: DropPlace): Promise<boolean> {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const d = (await unwrap(api.GET('/api/v1/assets/{asset_id}', { params: { path: { asset_id: assetId }, query: { include_energy: true } } }))) as AssetDetail
    if (d.status === 'ready') return addAssetToTimeline(assetId, place)
    if (d.status === 'failed') {
      toast.error(`${d.filename} could not be processed`, d.error ?? undefined)
      return false
    }
  }
  toast.warning('Still processing', 'Add it from the Media tab when it is ready.')
  return false
}

/** localUploadId -> where on the timeline the file was dropped. */
const pending = new Map<string, DropPlace>()

/** Upload files from the computer to the library (light mode) and add each to the timeline when ready. */
export function uploadAndAdd(files: File[], contentItemId: string, place: DropPlace = {}): number {
  const usable = files.filter(isMediaFile)
  if (!usable.length) {
    toast.info('Nothing to add', 'Drop video, audio or image files.')
    return 0
  }
  const items = enqueueUploads(usable, contentItemId, () => queryClient.invalidateQueries({ queryKey: ['assets'] }), { mode: 'light', tag: EDITOR_TAG })
  // several files dropped together go one after the other, not on top of each other
  let at = place.at
  for (const it of items) {
    pending.set(it.id, { at })
    if (at !== undefined) at += 3
  }
  toast.info(`Uploading ${usable.length === 1 ? usable[0].name : `${usable.length} files`}`, 'Saved to your library, then added to the timeline.')
  return usable.length
}

/** Mount once in the editor: adds every `editor`-tagged upload to the timeline once its processing has finished. */
export function useEditorUploadWatcher() {
  useEffect(() => {
    const started = new Set<string>()
    const check = () => {
      for (const it of useUploads.getState().items) {
        if (it.tag !== EDITOR_TAG || !pending.has(it.id) || started.has(it.id)) continue
        if (it.phase === 'failed') {
          pending.delete(it.id)
          toast.error(`Could not upload ${it.file.name}`, it.error?.message)
        } else if ((it.phase === 'processing' || it.phase === 'done') && it.assetId) {
          started.add(it.id)
          const place = pending.get(it.id) ?? {}
          pending.delete(it.id)
          void waitThenAdd(it.assetId, place).finally(() => void queryClient.invalidateQueries({ queryKey: ['assets'] }))
        }
      }
    }
    check()
    return useUploads.subscribe(check)
  }, [])
}
