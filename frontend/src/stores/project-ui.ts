import { create } from 'zustand'

/**
 * Per-viewer UI state of a project that has no API field: which uploaded video is the "primary" source for clip
 * generation. It is stored in localStorage (never sent to the server) and passed as `asset_id` when generating clips.
 */
const KEY = 'creatorai.primary-video'

function read(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

type State = {
  primary: Record<string, string>
  hydrated: boolean
  hydrate: () => void
  setPrimary: (projectId: string, assetId: string | null) => void
}

export const useProjectUi = create<State>((set, get) => ({
  primary: {},
  hydrated: false,
  hydrate: () => {
    if (!get().hydrated) set({ primary: read(), hydrated: true })
  },
  setPrimary: (projectId, assetId) => {
    const next = { ...get().primary }
    if (assetId) next[projectId] = assetId
    else delete next[projectId]
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* private mode: the choice lasts for this tab only */
    }
    set({ primary: next })
  },
}))
