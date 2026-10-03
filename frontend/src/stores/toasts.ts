import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'
export type ToastAction = { label: string; href?: string; onClick?: () => void }
export type Toast = {
  id: string
  tone: ToastTone
  title: string
  description?: string
  action?: ToastAction
  /** ms; 0 = sticky */
  duration: number
}

type ToastState = {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id' | 'duration'> & { id?: string; duration?: number }) => string
  dismiss: (id: string) => void
}

let n = 0
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = t.id ?? `t${++n}`
    const duration = t.duration ?? (t.tone === 'error' ? 8000 : 5000)
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== id), { ...t, id, duration }].slice(-4) }))
    const prev = timers.get(id)
    if (prev) clearTimeout(prev)
    if (duration > 0) timers.set(id, setTimeout(() => get().dismiss(id), duration))
    return id
  },
  dismiss: (id) => {
    const tm = timers.get(id)
    if (tm) clearTimeout(tm)
    timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
  },
}))

/** Imperative helper usable outside React (API error handler, stores). */
export const toast = {
  info: (title: string, description?: string) => useToasts.getState().push({ tone: 'info', title, description }),
  success: (title: string, description?: string) => useToasts.getState().push({ tone: 'success', title, description }),
  warning: (title: string, description?: string, action?: ToastAction) =>
    useToasts.getState().push({ tone: 'warning', title, description, action }),
  error: (title: string, description?: string, action?: ToastAction) =>
    useToasts.getState().push({ tone: 'error', title, description, action }),
}
