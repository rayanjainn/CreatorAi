/** Undo/redo stack with coalescing: edits that share a `key` within `windowMs` (or one drag gesture) become one step. */
export interface History<T> {
  past: T[]
  future: T[]
  /** Key of the edit that produced the newest `past` entry; null breaks coalescing. */
  lastKey: string | null
  lastAt: number
}

export const HISTORY_LIMIT = 200

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], lastKey: null, lastAt: 0 })

/** Record that the state is about to change away from `prev`. */
export function recordChange<T>(h: History<T>, prev: T, opts: { key?: string | null; now?: number; windowMs?: number } = {}): History<T> {
  const { key = null, now = Date.now(), windowMs = 900 } = opts
  if (key !== null && h.lastKey === key && now - h.lastAt <= windowMs && h.past.length > 0) {
    // same gesture: keep the pre-gesture snapshot, just extend the window
    return { ...h, future: [], lastAt: now }
  }
  const past = [...h.past, prev]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, future: [], lastKey: key, lastAt: now }
}

/** Stop coalescing (call at the end of a drag so the next edit starts a new step). */
export const breakCoalescing = <T>(h: History<T>): History<T> => (h.lastKey === null ? h : { ...h, lastKey: null })

export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (!h.past.length) return null
  const past = h.past.slice(0, -1)
  return { state: h.past[h.past.length - 1], history: { past, future: [current, ...h.future], lastKey: null, lastAt: 0 } }
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (!h.future.length) return null
  const [state, ...future] = h.future
  return { state, history: { past: [...h.past, current], future, lastKey: null, lastAt: 0 } }
}
