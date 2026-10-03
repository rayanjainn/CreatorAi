import { create } from 'zustand'

type NewContentPrefill = { title?: string; idea_text?: string; stage?: string }

type UiState = {
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  twinOpen: boolean
  setupDismissed: boolean
  dismissSetup: () => void
  newContentOpen: boolean
  newContentPrefill: NewContentPrefill | null
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void
  setMobileNav: (v: boolean) => void
  setTwinOpen: (v: boolean) => void
  openNewContent: (prefill?: NewContentPrefill) => void
  closeNewContent: () => void
}

const KEY = 'creatorai.sidebar'
const SETUP_KEY = 'creatorai.setup-dismissed'
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const useUi = create<UiState>((set, get) => ({
  sidebarCollapsed: false, // hydrated from localStorage in <UiHydrator/> to keep SSR markup stable
  mobileNavOpen: false,
  twinOpen: false,
  setupDismissed: false, // hydrated from sessionStorage
  dismissSetup: () => {
    try {
      window.sessionStorage.setItem(SETUP_KEY, '1')
    } catch {
      /* ignore */
    }
    set({ setupDismissed: true })
  },
  newContentOpen: false,
  newContentPrefill: null,
  setSidebarCollapsed: (v) => {
    try {
      window.localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ sidebarCollapsed: v })
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  setMobileNav: (v) => set({ mobileNavOpen: v }),
  setTwinOpen: (v) => set({ twinOpen: v }),
  openNewContent: (prefill) => set({ newContentOpen: true, newContentPrefill: prefill ?? null }),
  closeNewContent: () => set({ newContentOpen: false, newContentPrefill: null }),
}))

export function hydrateUi() {
  let dismissed = false
  try {
    dismissed = window.sessionStorage.getItem(SETUP_KEY) === '1'
  } catch {
    /* ignore */
  }
  useUi.setState({ sidebarCollapsed: readCollapsed(), setupDismissed: dismissed })
}
