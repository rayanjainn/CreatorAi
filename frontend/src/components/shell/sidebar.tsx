'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react'
import { NAV, isActive } from './nav'
import { useUi } from '@/stores/ui'
import { WorkspaceSwitcher } from '@/components/team/workspace-switcher'
import { DataModeChip } from '@/components/provenance/data-mode'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const pathname = usePathname()
  const collapsedPref = useUi((s) => s.sidebarCollapsed)
  const toggle = useUi((s) => s.toggleSidebar)
  const mobileOpen = useUi((s) => s.mobileNavOpen)
  const setMobile = useUi((s) => s.setMobileNav)
  const collapsed = collapsedPref && !mobileOpen

  return (
    <>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobile(false)} aria-hidden />}
      <aside className={cn('sidebar', collapsed && 'collapsed', mobileOpen && 'mobile-open')} aria-label="Primary">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link href="/dashboard" className="brand" style={{ flex: 1, minWidth: 0 }} onClick={() => setMobile(false)}>
            <div className="brand-mark">
              <Sparkles size={18} />
            </div>
            {!collapsed && (
              <strong>
                Creator<span>AI</span>
              </strong>
            )}
          </Link>
          {mobileOpen && (
            <button className="icon-button" aria-label="Close menu" onClick={() => setMobile(false)}>
              <X size={17} />
            </button>
          )}
        </div>

        <WorkspaceSwitcher collapsed={collapsed} />

        <nav className="side-nav" aria-label="Main navigation">
          {NAV.map((group) => (
            <div key={group.label} style={{ display: 'contents' }}>
              <div className="nav-label">{group.label}</div>
              {group.items.map(({ label, href, Icon, soon }) => {
                const active = isActive(pathname, href)
                const link = (
                  <Link
                    key={href}
                    href={href}
                    className={cn('nav-item', active && 'active')}
                    aria-current={active ? 'page' : undefined}
                    aria-label={collapsed ? label : undefined}
                    onClick={() => setMobile(false)}
                  >
                    <Icon size={17} aria-hidden />
                    {!collapsed && <span>{label}</span>}
                    {soon && !collapsed && <i>Soon</i>}
                    {soon && collapsed && <span className="nav-dot" aria-hidden style={{ display: 'block' }} />}
                  </Link>
                )
                return collapsed ? (
                  <Tooltip key={href} content={soon ? `${label} (not available yet)` : label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="hide-rail" style={{ display: collapsed ? 'none' : 'block' }}>
            <DataModeChip />
          </div>
        </div>

        <button className="icon-button sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggle}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </aside>
    </>
  )
}
