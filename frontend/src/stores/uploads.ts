import { create } from 'zustand'

export type UploadPhase = 'queued' | 'starting' | 'uploading' | 'finalizing' | 'processing' | 'done' | 'failed' | 'aborted'

export type UploadItem = {
  /** Local id (not the server's upload id). */
  id: string
  file: File
  contentItemId?: string
  phase: UploadPhase
  uploadId?: string
  chunkSize?: number
  totalChunks?: number
  sentBytes: number
  /** Bytes per second over the last few seconds. */
  speed: number
  etaSec: number | null
  assetId?: string
  jobId?: string | null
  /** The file was already in the library (same sha256): no new asset or job. */
  duplicate?: boolean
  error?: { code: string; message: string }
  startedAt?: number
}

type UploadsState = {
  items: UploadItem[]
  add: (items: UploadItem[]) => void
  patch: (id: string, patch: Partial<UploadItem>) => void
  remove: (id: string) => void
  clearFinished: () => void
}

export const useUploads = create<UploadsState>((set) => ({
  items: [],
  add: (items) => set((s) => ({ items: [...s.items, ...items] })),
  patch: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clearFinished: () => set((s) => ({ items: s.items.filter((i) => !['done', 'failed', 'aborted'].includes(i.phase)) })),
}))
