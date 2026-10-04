'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Popover } from '@base-ui/react/popover'
import { ArrowRight, Check, ChevronDown, Loader2, MessageSquare, Pencil, X } from 'lucide-react'
import { StageBadge } from '@/components/common/stage-badge'
import { ProgressRing } from '@/components/common/progress-ring'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup } from '@/components/ui/menu'
import { CommentsPanel } from '@/components/team/comments-panel'
import { PresenceStack } from '@/components/team/presence-stack'
import { SharePopover } from '@/components/team/share-popover'
import { useRole } from '@/lib/use-role'
import { useComments, useContentList, useMoveContent, usePatchContent } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { STAGES, STAGE_LABEL, isDemoTitle, stripDemo } from '@/lib/format'
import { jobLabel } from '@/lib/format'
import { useActiveJobs } from '@/stores/jobs'
import type { Card, Stage } from '@/lib/api/types'

/** Header of the project workspace: editable title, stage + advance button, switcher, progress, running jobs. */
export function ProjectHeader({ item }: { item: Card }) {
  const stage = item.stage as Stage
  const { readOnly } = useRole()
  const where = usePathname().split('/')[3] ?? 'plan'
  const nextStage = STAGES[STAGES.findIndex((s) => s.id === stage) + 1]?.id
  return (
    <header className="project-head" data-testid="project-header">
      <div className="project-head-main">
        <div className="project-head-badges">
          <StageBadge stage={stage} />
          {isDemoTitle(item.title) && <ProvenanceBadge source="demo" />}
        </div>
        <EditableTitle id={item.id} title={item.title} />
      </div>
      <div className="project-head-side">
        <PresenceStack itemId={item.id} where={where} />
        <ProgressRing percent={item.progress.percent} />
        <CommentsButton itemId={item.id} />
        <SharePopover itemId={item.id} />
        <StageControl key={stage} id={item.id} stage={stage} next={nextStage} hasScript={item.progress.has_script} readOnly={readOnly} />
        <Switcher currentId={item.id} />
      </div>
      <JobsStrip item={item} />
    </header>
  )
}

function EditableTitle({ id, title }: { id: string; title: string }) {
  const { readOnly } = useRole()
  const patch = usePatchContent()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  const [seen, setSeen] = useState(title)
  if (seen !== title) {
    setSeen(title)
    setDraft(title)
  }
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === title) {
      setDraft(title)
      return
    }
    patch.mutate({ id, patch: { title: next } }, { onError: () => setDraft(title) })
  }

  if (editing) {
    return (
      <form
        className="title-edit"
        onSubmit={(e) => {
          e.preventDefault()
          commit()
        }}
      >
        <input
          ref={input}
          className="title-input"
          value={draft}
          maxLength={200}
          aria-label="Project title"
          data-testid="title-input"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(title)
              setEditing(false)
            }
          }}
        />
        <button type="submit" className="icon-button" aria-label="Save title" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
          <Check size={15} />
        </button>
        <button type="button" className="icon-button" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft(title); setEditing(false) }}>
          <X size={15} />
        </button>
      </form>
    )
  }
  return (
    <div className="title-row">
      <h1 data-testid="project-title">{stripDemo(title)}</h1>
      {!readOnly && <button type="button" className="icon-button title-pencil" aria-label="Rename project" title="Rename" onClick={() => setEditing(true)} data-testid="rename-project">
        {patch.isPending ? <Loader2 size={14} className="spin" /> : <Pencil size={14} />}
      </button>}
    </div>
  )
}

function StageControl({ id, stage, next, hasScript, readOnly }: { id: string; stage: Stage; next?: Stage; hasScript: boolean; readOnly?: boolean }) {
  const move = useMoveContent()
  const pathname = usePathname()
  const [needScript, setNeedScript] = useState(false)
  const go = (to: Stage) => {
    setNeedScript(false)
    move.mutate({ id, stage: to }, { onError: (e) => setNeedScript(isCode(e, 'NO_SCRIPT')) })
  }
  const base = pathname.split('/').slice(0, 3).join('/')
  if (readOnly) return <span className="muted small" data-testid="view-only">View only</span>
  return (
    <div className="stage-control">
      {next ? (
        <Button size="sm" onClick={() => go(next)} loading={move.isPending} data-testid="advance-stage" title={next === 'shoot' && !hasScript ? 'Needs a script with scenes' : undefined}>
          Move to {STAGE_LABEL[next]} <ArrowRight size={13} />
        </Button>
      ) : (
        <span className="muted small">Final stage</span>
      )}
      <Menu.Root>
        <Menu.Trigger className="icon-button bordered" aria-label="Move to another stage" data-testid="stage-menu">
          <ChevronDown size={15} />
        </Menu.Trigger>
        <MenuPopup>
          {STAGES.map((s) => (
            <MenuItem key={s.id} disabled={s.id === stage} onClick={() => go(s.id)}>
              <span className="stage-dot" data-stage={s.id} /> {s.label}
              {s.id === stage ? ' (current)' : ''}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu.Root>
      {needScript && (
        <div className="stage-warning" role="alert" data-testid="no-script-warning">
          Moving to Shoot needs an approved-able script with scenes. <Link href={`${base}/script`}>Write one in the Script tab</Link>, then try again.
        </div>
      )}
    </div>
  )
}

function Switcher({ currentId }: { currentId: string }) {
  const list = useContentList()
  const router = useRouter()
  const pathname = usePathname()
  const tab = pathname.split('/')[3] ?? 'plan'
  const items = list.data?.items ?? []
  return (
    <Menu.Root>
      <Menu.Trigger className="button button-secondary button-sm" aria-label="Switch project" data-testid="project-switcher">
        Switch <ChevronDown size={13} />
      </Menu.Trigger>
      <MenuPopup className="switcher-popup">
        {list.isPending ? (
          <div className="menu-head">
            <small>Loading…</small>
          </div>
        ) : items.length === 0 ? (
          <div className="menu-head">
            <small>No other projects</small>
          </div>
        ) : (
          items.map((c) => (
            <MenuItem key={c.id} disabled={c.id === currentId} onClick={() => router.push(`/projects/${c.id}/${tab}`)}>
              <span className="stage-dot" data-stage={c.stage} />
              <span className="truncate" style={{ maxWidth: 240 }}>
                {stripDemo(c.title)}
              </span>
              {c.id === currentId && <Check size={13} style={{ marginLeft: 'auto' }} />}
            </MenuItem>
          ))
        )}
      </MenuPopup>
    </Menu.Root>
  )
}

function JobsStrip({ item }: { item: Card }) {
  const active = useActiveJobs()
  const mine = active.filter((j) => j.entityId === item.id)
  if (!item.running_jobs.active && mine.length === 0) return null
  const shown = mine.length
    ? mine
    : item.running_jobs.types.map((t) => ({ id: t, label: jobLabel(t), progress: 0, stage: '' }))
  return (
    <div className="jobs-strip" role="status" data-testid="jobs-strip">
      <span className="spinner" style={{ width: 12, height: 12 }} aria-hidden />
      {shown.map((j) => (
        <span key={j.id} className="jobs-strip-item">
          {j.label}
          {j.progress ? ` ${Math.round(j.progress)}%` : ''}
          {j.stage && j.stage !== 'queued' ? ` · ${j.stage}` : ''}
        </span>
      ))}
      <Link href="/jobs" className="link">
        All jobs
      </Link>
    </div>
  )
}

function CommentsButton({ itemId }: { itemId: string }) {
  const list = useComments(itemId)
  const open = (list.data ?? []).filter((c) => !c.resolved).length
  return (
    <Popover.Root>
      <Popover.Trigger className="button button-secondary button-sm" data-testid="comments-open" aria-label={`Comments, ${open} open`}>
        <MessageSquare size={13} /> {open > 0 ? open : 'Comments'}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 70 }}>
          <Popover.Popup className="popover comments-popover">
            <div className="popover-head">
              <b>Comments</b>
              <small>Visible to everyone who can open this project.</small>
            </div>
            <CommentsPanel itemId={itemId} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
