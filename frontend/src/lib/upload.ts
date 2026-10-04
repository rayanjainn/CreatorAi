import { api, API_URL, unwrap } from '@/lib/api/client'
import { ApiError, isApiError, toApiError } from '@/lib/api/errors'
import { getTokenOrMemory } from '@/lib/auth'
import { trackJob } from '@/lib/track-job'
import { useUploads, type UploadItem } from '@/stores/uploads'
import type { UploadComplete, UploadOut } from '@/lib/api/types'

const PARALLEL = 4
const RETRIES = 3

type Run = { aborted: boolean; xhrs: Set<XMLHttpRequest> }
const runs = new Map<string, Run>()

let seq = 0
export type UploadOptions = { mode?: 'full' | 'light'; tag?: string }

export function newUploadItem(file: File, contentItemId?: string, opts: UploadOptions = {}): UploadItem {
  return { id: `u${Date.now().toString(36)}${++seq}`, file, contentItemId, mode: opts.mode, tag: opts.tag, phase: 'queued', sentBytes: 0, speed: 0, etaSec: null }
}

/** Queue files and start uploading them (two files at a time so one slow upload does not starve the rest). */
export function enqueueUploads(files: File[], contentItemId?: string, onDone?: () => void, opts: UploadOptions = {}): UploadItem[] {
  const items = files.map((f) => newUploadItem(f, contentItemId, opts))
  useUploads.getState().add(items)
  void runQueue(items, onDone)
  return items
}

async function runQueue(items: UploadItem[], onDone?: () => void) {
  const pending = [...items]
  const worker = async () => {
    for (let it = pending.shift(); it; it = pending.shift()) {
      await startUpload(it.id)
    }
  }
  await Promise.all([worker(), worker()])
  onDone?.()
}

export function abortUpload(id: string) {
  const run = runs.get(id)
  const item = useUploads.getState().items.find((i) => i.id === id)
  if (run) {
    run.aborted = true
    run.xhrs.forEach((x) => x.abort())
  }
  if (item?.uploadId && item.phase !== 'done' && item.phase !== 'processing') {
    void api.POST('/api/v1/uploads/{upload_id}/abort', { params: { path: { upload_id: item.uploadId } } }).catch(() => undefined)
  }
  if (item && !['done', 'processing'].includes(item.phase)) useUploads.getState().patch(id, { phase: 'aborted', speed: 0, etaSec: null })
}

/** Retry a failed upload: resumes at the first chunk the server does not have. */
export function retryUpload(id: string) {
  useUploads.getState().patch(id, { phase: 'queued', error: undefined })
  void startUpload(id)
}

function putChunk(uploadId: string, n: number, blob: Blob, run: Run, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    run.xhrs.add(xhr)
    xhr.open('PUT', `${API_URL}/api/v1/uploads/${encodeURIComponent(uploadId)}/chunks/${n}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    const token = getTokenOrMemory()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded)
    xhr.onerror = () => {
      run.xhrs.delete(xhr)
      reject(new ApiError(0, 'NETWORK_ERROR', `Cannot reach the API at ${API_URL}.`))
    }
    xhr.onabort = () => {
      run.xhrs.delete(xhr)
      reject(new ApiError(0, 'ABORTED', 'Upload canceled'))
    }
    xhr.onload = () => {
      run.xhrs.delete(xhr)
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON */
      }
      reject(toApiError(xhr.status, body))
    }
    xhr.send(blob)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Chunked, resumable upload of one queued item, then hands the asset's job to the jobs store. */
export async function startUpload(id: string): Promise<void> {
  const store = useUploads.getState
  const item = store().items.find((i) => i.id === id)
  if (!item) return
  const run: Run = { aborted: false, xhrs: new Set() }
  runs.set(id, run)
  const patch = (p: Partial<UploadItem>) => store().patch(id, p)
  const { file } = item
  try {
    if (file.size === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'This file is empty.')
    patch({ phase: 'starting', startedAt: Date.now(), error: undefined })

    // Resume when the server still has this upload, otherwise start a new one.
    let upload: UploadOut | null = null
    if (item.uploadId) {
      try {
        upload = (await unwrap(api.GET('/api/v1/uploads/{upload_id}', { params: { path: { upload_id: item.uploadId } } }))) as UploadOut
      } catch {
        upload = null
      }
    }
    if (!upload) {
      upload = (await unwrap(
        api.POST('/api/v1/uploads', {
          body: { filename: file.name, mime: file.type || undefined, size_bytes: file.size, content_item_id: item.contentItemId ?? null },
        }),
      )) as UploadOut
    }
    const up = upload
    patch({ uploadId: up.id, chunkSize: up.chunk_size, totalChunks: up.total_chunks, phase: 'uploading' })

    const have = new Set(up.received_chunks)
    const todo = Array.from({ length: up.total_chunks }, (_, i) => i).filter((i) => !have.has(i))
    const sizeOf = (i: number) => Math.min(file.size, (i + 1) * up.chunk_size) - i * up.chunk_size
    let doneBytes = [...have].reduce((a, i) => a + sizeOf(i), 0)
    const inflight = new Map<number, number>()
    const samples: { t: number; b: number }[] = []
    const report = () => {
      const sent = doneBytes + [...inflight.values()].reduce((a, b) => a + b, 0)
      const now = Date.now()
      samples.push({ t: now, b: sent })
      while (samples.length > 2 && now - samples[0].t > 4000) samples.shift()
      const first = samples[0]
      const dt = (now - first.t) / 1000
      const speed = dt > 0.3 ? (sent - first.b) / dt : 0
      patch({ sentBytes: sent, speed, etaSec: speed > 0 ? (file.size - sent) / speed : null })
    }
    report()

    const next = [...todo]
    const worker = async () => {
      for (let n = next.shift(); n !== undefined; n = next.shift()) {
        if (run.aborted) return
        const blob = file.slice(n * up.chunk_size, n * up.chunk_size + sizeOf(n))
        for (let attempt = 0; ; attempt++) {
          try {
            inflight.set(n, 0)
            await putChunk(up.id, n, blob, run, (loaded) => {
              inflight.set(n, loaded)
              report()
            })
            break
          } catch (e) {
            inflight.delete(n)
            const retryable = isApiError(e) && (e.code === 'NETWORK_ERROR' || e.status >= 500)
            if (run.aborted || !retryable || attempt >= RETRIES) throw e
            await sleep(600 * 2 ** attempt)
          }
        }
        inflight.delete(n)
        doneBytes += sizeOf(n)
        report()
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker))
    if (run.aborted) return

    patch({ phase: 'finalizing', sentBytes: file.size, speed: 0, etaSec: null })
    const done = (await unwrap(api.POST('/api/v1/uploads/{upload_id}/complete', { params: { path: { upload_id: up.id } }, body: { mode: item.mode ?? 'full' } }))) as UploadComplete
    if (done.job_id) void trackJob(done.job_id)
    patch({ phase: done.duplicate ? 'done' : 'processing', assetId: done.asset.id, jobId: done.job_id, duplicate: done.duplicate })
  } catch (e) {
    if (run.aborted || (isApiError(e) && e.code === 'ABORTED')) return
    const err = isApiError(e) ? e : new ApiError(0, 'UPLOAD_FAILED', e instanceof Error ? e.message : 'Upload failed')
    patch({ phase: 'failed', speed: 0, etaSec: null, error: { code: err.code, message: err.message } })
  } finally {
    runs.delete(id)
  }
}
