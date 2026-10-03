import { describe, expect, it } from 'vitest'
import { breakCoalescing, emptyHistory, recordChange, redo, undo, HISTORY_LIMIT, type History } from './history'

describe('undo/redo history', () => {
  it('undo and redo walk the stack', () => {
    let h: History<number> = emptyHistory()
    h = recordChange(h, 1)
    h = recordChange(h, 2)
    const u = undo(h, 3)!
    expect(u.state).toBe(2)
    const u2 = undo(u.history, 2)!
    expect(u2.state).toBe(1)
    expect(undo(u2.history, 1)).toBeNull()
    const r = redo(u2.history, 1)!
    expect(r.state).toBe(2)
    expect(redo(r.history, 2)!.state).toBe(3)
  })
  it('a new change clears the redo stack', () => {
    let h: History<number> = emptyHistory()
    h = recordChange(h, 1)
    h = undo(h, 2)!.history
    expect(h.future).toEqual([2])
    h = recordChange(h, 1)
    expect(h.future).toEqual([])
  })
  it('coalesces edits with the same key inside the window (a drag is one step)', () => {
    let h: History<number> = emptyHistory()
    h = recordChange(h, 0, { key: 'drag', now: 1000 })
    for (let n = 1; n < 30; n++) h = recordChange(h, n, { key: 'drag', now: 1000 + n * 16 })
    expect(h.past).toEqual([0])
    // a different key, a long pause or an explicit break start a new step
    h = recordChange(h, 30, { key: 'other', now: 1500 })
    expect(h.past).toEqual([0, 30])
    h = recordChange(h, 31, { key: 'other', now: 5000 })
    expect(h.past).toEqual([0, 30, 31])
    h = breakCoalescing(h)
    h = recordChange(h, 32, { key: 'other', now: 5010 })
    expect(h.past).toHaveLength(4)
  })
  it('un-keyed edits never coalesce', () => {
    let h: History<number> = emptyHistory()
    h = recordChange(h, 1, { now: 1 })
    h = recordChange(h, 2, { now: 2 })
    expect(h.past).toEqual([1, 2])
  })
  it('is bounded', () => {
    let h: History<number> = emptyHistory()
    for (let n = 0; n < HISTORY_LIMIT + 50; n++) h = recordChange(h, n)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toBe(50)
  })
})
