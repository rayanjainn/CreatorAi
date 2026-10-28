'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { TwinDrawer } from './twin-drawer'
import { JobToasts } from './job-toasts'
import { JobsProvider } from './jobs-provider'
import { DataModeBanner } from '@/components/provenance/data-mode'
import { NewContentDialog } from '@/components/board/new-content-dialog'
import { hydrateUi, useUi } from '@/stores/ui'
import { CommandPalette } from './command-palette'

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const setMobile = useUi((s) => s.setMobileNav)
  const commandOpen = useUi((s) => s.commandOpen)
  const setCommandOpen = useUi((s) => s.setCommandOpen)

  useEffect(() => {
    hydrateUi()
  }, [])
  useEffect(() => {
    setMobile(false)
  }, [pathname, setMobile])

  // "/" focuses global search (like most dev tools), unless typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUi.getState().setCommandOpen(!useUi.getState().commandOpen)
        return
      }
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      document.getElementById('global-search')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // the clip editor is a full-bleed workspace with its own header: no sidebar, topbar or banner
  const focus = pathname.startsWith('/editor/') || pathname.startsWith('/teleprompter/')

  return (
    <div className="app-shell" data-focus={focus || undefined}>
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      {!focus && <Sidebar />}
      <div className="app-main">
        {!focus && <Topbar />}
        {!focus && <DataModeBanner />}
        <main id="main" className="app-content">
          {children}
        </main>
      </div>
      <TwinDrawer />
      <JobToasts />
      <JobsProvider />
      <NewContentDialog />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  )
}
