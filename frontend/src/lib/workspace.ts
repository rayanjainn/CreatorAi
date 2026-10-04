/**
 * The workspace the user is working in. Everyone has a home workspace (their own); they can also belong to others. The active
 * one is sent with every request as `X-Workspace-Id` (or `?workspace=` where headers are impossible). `null` means home.
 */
const KEY = 'creatorai.workspace'

let memory: string | null = null
const listeners = new Set<() => void>()

export function getActiveWorkspace(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(KEY) ?? memory
  } catch {
    return memory
  }
}

export function setActiveWorkspace(id: string | null): void {
  memory = id
  try {
    if (id) window.localStorage.setItem(KEY, id)
    else window.localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: lasts until reload */
  }
  listeners.forEach((l) => l())
}

export function subscribeWorkspace(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
