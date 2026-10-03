'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Activity, ChevronRight, LogOut, Menu as MenuIcon, Plus, Search, Settings, Sparkles, UserRound } from 'lucide-react'
import { Menu, MenuItem, MenuPopup } from '@/components/ui/menu'
import { DataModeChip } from '@/components/provenance/data-mode'
import { useAuth } from '@/components/auth-provider'
import { useContentItem } from '@/lib/api/hooks'
import { initials } from '@/lib/format'
import { useUi } from '@/stores/ui'
import { useActiveJobs, useJobs } from '@/stores/jobs'
import { ROUTE_TITLES } from './nav'
import { Button } from '@/components/ui/button'

function Breadcrumbs() {
  const pathname = usePathname()
  const parts = pathname.split('/').filter(Boolean)
  const root = parts[0] ?? 'dashboard'
  const title = ROUTE_TITLES[root] ?? root
  const projectId = root === 'projects' && parts[1] ? parts[1] : undefined
  const item = useContentItem(projectId)
  const sub = parts[2]
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link href="/dashboard" className="crumb-root">
        Studio
      </Link>
      <ChevronRight size={12} className="crumb-root" aria-hidden />
      {projectId ? (
        <>
          <Link href="/projects">{title}</Link>
          <ChevronRight size={12} aria-hidden />
          <b className={sub ? undefined : undefined} style={{ maxWidth: 260 }} aria-current={sub ? undefined : 'page'}>
            {item.data?.title ?? 'Project'}
          </b>
          {sub && (
            <>
              <ChevronRight size={12} aria-hidden />
              <b aria-current="page" style={{ textTransform: 'capitalize' }}>
                {sub}
              </b>
            </>
          )}
        </>
      ) : (
        <b aria-current="page">{title}</b>
      )}
    </nav>
  )
}

function GlobalSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = q.trim()
    if (v) router.push(`/search?q=${encodeURIComponent(v)}`)
  }
  return (
    <>
      <form className="search-trigger" role="search" onSubmit={submit}>
        <Search size={14} aria-hidden />
        <input
          type="search"
          aria-label="Search your footage and content"
          placeholder="Search your footage…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          id="global-search"
        />
        <kbd aria-hidden>/</kbd>
      </form>
      <Link href="/search" className="icon-button search-mobile" aria-label="Search">
        <Search size={17} />
      </Link>
    </>
  )
}

function JobIndicator() {
  const active = useActiveJobs()
  if (!active.length) {
    return (
      <Link href="/jobs" className="job-indicator idle hide-sm" aria-label="Jobs and activity">
        <Activity size={15} />
      </Link>
    )
  }
  const avg = Math.round(active.reduce((a, j) => a + j.progress, 0) / active.length)
  return (
    <Link href="/jobs" className="job-indicator" aria-label={`${active.length} job${active.length > 1 ? 's' : ''} running`} data-testid="job-indicator">
      <span className="spinner" aria-hidden />
      <span>
        {active.length} running{avg ? ` · ${avg}%` : ''}
      </span>
    </Link>
  )
}

function UserMenu() {
  const { me, profile, logout } = useAuth()
  const name = profile?.display_name ?? me?.user.email ?? ''
  const setTwin = useUi((s) => s.setTwinOpen)
  const router = useRouter()
  return (
    <Menu.Root>
      <Menu.Trigger className="user-trigger" aria-label="Account menu" data-testid="user-menu">
        <span className="avatar">{initials(name)}</span>
      </Menu.Trigger>
      <MenuPopup>
        <div className="menu-head">
          <b>{profile?.display_name}</b>
          <small>{me?.user.email}</small>
        </div>
        <MenuItem onClick={() => router.push('/settings')}>
          <UserRound /> Profile & settings
        </MenuItem>
        <MenuItem onClick={() => router.push('/jobs')}>
          <Activity /> Jobs & activity
        </MenuItem>
        <MenuItem onClick={() => setTwin(true)}>
          <Sparkles /> Creative Twin
        </MenuItem>
        <MenuItem onClick={() => router.push('/settings#llm')}>
          <Settings /> AI providers
        </MenuItem>
        <div className="menu-sep" />
        <MenuItem onClick={logout} danger>
          <LogOut /> Sign out
        </MenuItem>
      </MenuPopup>
    </Menu.Root>
  )
}

export function Topbar() {
  const setMobile = useUi((s) => s.setMobileNav)
  const openNew = useUi((s) => s.openNewContent)
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button menu-button" aria-label="Open menu" onClick={() => setMobile(true)}>
          <MenuIcon size={18} />
        </button>
        <Breadcrumbs />
      </div>
      <div className="top-actions">
        <GlobalSearch />
        <JobIndicator />
        <span className="hide-sm">
          <DataModeChip />
        </span>
        <Button size="sm" onClick={() => openNew()} data-testid="new-content">
          <Plus size={15} /> <span className="hide-sm">New content</span>
        </Button>
        <UserMenu />
      </div>
    </header>
  )
}
