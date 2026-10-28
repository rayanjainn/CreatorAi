'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { ArrowRight, CornerDownLeft, FileText, FolderKanban, Mic, Plus, Search } from 'lucide-react'
import { useContentList } from '@/lib/api/hooks'
import { stripDemo } from '@/lib/format'
import { useUi } from '@/stores/ui'
import { NAV } from './nav'

type Command = { id: string; group: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; keywords?: string }

const matches = (c: Command, q: string) => {
  if (!q) return true
  const hay = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((t) => hay.includes(t))
}

/** ⌘K / Ctrl+K: jump to any page or project, or start something, from anywhere in the app. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const openNewContent = useUi((s) => s.openNewContent)
  const projects = useContentList({})
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const go = (href: string) => () => router.push(href)
  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [
      { id: 'new', group: 'Actions', label: 'New content', hint: 'Start a project from an idea', icon: <Plus size={15} />, run: () => openNewContent(), keywords: 'create idea project add' },
    ]
    if (q.trim().length >= 2)
      out.push({ id: 'search', group: 'Actions', label: `Search footage for “${q.trim()}”`, icon: <Search size={15} />, run: go(`/search?q=${encodeURIComponent(q.trim())}`), keywords: q })
    for (const g of NAV)
      for (const item of g.items)
        out.push({ id: `nav:${item.href}`, group: 'Go to', label: item.label, hint: g.label, icon: <item.Icon size={15} />, run: go(item.href) })
    for (const p of projects.data?.items ?? []) {
      const title = stripDemo(p.title)
      out.push({ id: `p:${p.id}`, group: 'Projects', label: title, hint: p.stage, icon: <FolderKanban size={15} />, run: go(`/projects/${p.id}/plan`), keywords: 'project' })
      out.push({ id: `s:${p.id}`, group: 'Script & record', label: `Script: ${title}`, icon: <FileText size={15} />, run: go(`/projects/${p.id}/script`), keywords: 'write script' })
      out.push({ id: `t:${p.id}`, group: 'Script & record', label: `Teleprompter: ${title}`, icon: <Mic size={15} />, run: go(`/teleprompter/${p.id}`), keywords: 'record read prompter' })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.data, q])

  const shown = useMemo(() => {
    const hits = commands.filter((c) => matches(c, q.trim()))
    // without a query, keep the list short: actions, pages, then a few projects
    if (!q.trim()) return hits.filter((c) => c.group !== 'Script & record').slice(0, 24)
    return hits.slice(0, 40)
  }, [commands, q])

  const pick = (c: Command | undefined) => {
    if (!c) return
    setQ('')
    setActive(0)
    onOpenChange(false)
    c.run()
  }

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(shown.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(shown[active])
    }
  }

  let lastGroup = ''
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQ('')
          setActive(0)
        }
        onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <div className="cmdk-wrap">
          <Dialog.Popup className="cmdk" data-testid="command-palette">
            <Dialog.Title className="sr-only">Command palette</Dialog.Title>
            <div className="cmdk-input">
              <Search size={16} aria-hidden />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKey}
                placeholder="Go to a page, a project, or type an action…"
                aria-label="Command"
                role="combobox"
                aria-expanded="true"
                aria-controls="cmdk-list"
                aria-activedescendant={shown[active] ? `cmdk-${active}` : undefined}
                data-testid="command-input"
              />
              <kbd>esc</kbd>
            </div>
            <div className="cmdk-list" id="cmdk-list" role="listbox" ref={list}>
              {shown.length === 0 && <p className="cmdk-empty">Nothing matches “{q}”.</p>}
              {shown.map((c, i) => {
                const head = c.group !== lastGroup ? c.group : null
                lastGroup = c.group
                return (
                  <div key={c.id}>
                    {head && <div className="cmdk-group">{head}</div>}
                    <button
                      type="button"
                      id={`cmdk-${i}`}
                      role="option"
                      aria-selected={i === active}
                      data-index={i}
                      className="cmdk-item"
                      onMouseMove={() => setActive(i)}
                      onClick={() => pick(c)}
                    >
                      <span className="cmdk-icon">{c.icon}</span>
                      <span className="cmdk-label">{c.label}</span>
                      {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                      {i === active ? <CornerDownLeft size={13} className="cmdk-enter" /> : <ArrowRight size={13} className="cmdk-enter dim" />}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="cmdk-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> move
              </span>
              <span>
                <kbd>↵</kbd> open
              </span>
              <span>
                <kbd>⌘</kbd>
                <kbd>K</kbd> anywhere
              </span>
            </div>
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
