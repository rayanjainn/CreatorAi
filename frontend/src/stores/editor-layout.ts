import { create } from 'zustand'

/** Panel sizes of the clip editor. Remembered per browser; every read and write is guarded (private windows, SSR). */
const KEY = 'creatorai.editor-layout.v1'

export const LAYOUT_LIMITS = {
  left: { min: 220, max: 520, def: 300 },
  right: { min: 250, max: 560, def: 316 },
  timeline: { min: 150, max: 760, def: 300 },
} as const

type Stored = { left: number; right: number; timeline: number; leftOpen: boolean; rightOpen: boolean }

type LayoutState = Stored & {
  hydrated: boolean
  hydrate: () => void
  setLeft: (px: number) => void
  setRight: (px: number) => void
  setTimeline: (px: number) => void
  toggleLeft: () => void
  toggleRight: () => void
  reset: () => void
}

const clamp = (v: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, v)))
const defaults = (): Stored => ({
  left: LAYOUT_LIMITS.left.def,
  right: LAYOUT_LIMITS.right.def,
  timeline: LAYOUT_LIMITS.timeline.def,
  leftOpen: true,
  rightOpen: true,
})

function save(s: Stored) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: the layout simply is not remembered */
  }
}

function pick(s: LayoutState): Stored {
  return { left: s.left, right: s.right, timeline: s.timeline, leftOpen: s.leftOpen, rightOpen: s.rightOpen }
}

export const useEditorLayout = create<LayoutState>((set, get) => ({
  ...defaults(),
  hydrated: false, // hydrated after mount so the server markup matches the first client render
  hydrate: () => {
    if (get().hydrated) return
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) {
        const v = JSON.parse(raw) as Partial<Stored>
        const d = defaults()
        set({
          left: clamp(Number(v.left ?? d.left), LAYOUT_LIMITS.left.min, LAYOUT_LIMITS.left.max),
          right: clamp(Number(v.right ?? d.right), LAYOUT_LIMITS.right.min, LAYOUT_LIMITS.right.max),
          timeline: clamp(Number(v.timeline ?? d.timeline), LAYOUT_LIMITS.timeline.min, LAYOUT_LIMITS.timeline.max),
          leftOpen: v.leftOpen !== false,
          rightOpen: v.rightOpen !== false,
        })
      }
    } catch {
      /* corrupt or blocked storage: keep the defaults */
    }
    set({ hydrated: true })
  },
  setLeft: (px) => {
    set({ left: clamp(px, LAYOUT_LIMITS.left.min, LAYOUT_LIMITS.left.max) })
    save(pick(get()))
  },
  setRight: (px) => {
    set({ right: clamp(px, LAYOUT_LIMITS.right.min, LAYOUT_LIMITS.right.max) })
    save(pick(get()))
  },
  setTimeline: (px) => {
    set({ timeline: clamp(px, LAYOUT_LIMITS.timeline.min, LAYOUT_LIMITS.timeline.max) })
    save(pick(get()))
  },
  toggleLeft: () => {
    set({ leftOpen: !get().leftOpen })
    save(pick(get()))
  },
  toggleRight: () => {
    set({ rightOpen: !get().rightOpen })
    save(pick(get()))
  },
  reset: () => {
    set(defaults())
    save(defaults())
  },
}))
