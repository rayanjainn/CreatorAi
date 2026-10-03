import { useState } from 'react'

/**
 * `useState` that snaps back to `initial` whenever `key` changes (render-phase reset, the pattern React recommends over an
 * effect). Used for text drafts that must follow the item they edit.
 */
export function useResettable<T>(initial: T, key: unknown): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)
  const [seen, setSeen] = useState<unknown>(key)
  if (!Object.is(seen, key)) {
    setSeen(key)
    setValue(initial)
  }
  return [value, setValue]
}
