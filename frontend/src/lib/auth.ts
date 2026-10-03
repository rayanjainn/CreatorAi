/** Token storage. localStorage only; every access is guarded (private windows, SSR, blocked storage). */
const KEY = 'creatorai.token'

let memoryToken: string | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}
/** Alias kept for the API client. */
export const getTokenOrMemory = getToken

export function setToken(token: string): void {
  memoryToken = token
  try {
    window.localStorage.setItem(KEY, token)
  } catch {
    /* storage unavailable: the session lasts until reload */
  }
  notify()
}

export function clearToken(): void {
  memoryToken = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  notify()
}

/** For useSyncExternalStore. */
export function subscribeToken(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** Where to go after sign-in / on boot, given the profile. */
export function homeFor(profile: { onboarding_done: boolean } | undefined, next?: string | null): string {
  if (profile && !profile.onboarding_done) return '/onboarding'
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/dashboard'
}
