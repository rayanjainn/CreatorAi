'use client'

import { useEffect, useRef, useState } from 'react'
import { useResettable } from '@/lib/editor/use-resettable'
import Link from 'next/link'
import { Popover } from '@base-ui/react/popover'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Clapperboard, History, Keyboard, Loader2, Pencil, PanelLeft, PanelRight, Redo2, RotateCcw, Send, Undo2, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { PresenceStack } from '@/components/team/presence-stack'
import { RevisionList } from './revision-list'
import { SaveStatus } from './save-status'
import { SHORTCUTS } from './use-shortcuts'
import { acceptAllLayers } from '@/lib/editor/actions'
import { useClipRenders, usePatchClip } from '@/lib/api/hooks'
import type { Clip } from '@/lib/api/types'
import { stripDemo, isDemoTitle } from '@/lib/format'
import { totals } from '@/lib/timeline'
import { useEditor, viewTimeline } from '@/stores/editor'
import { useEditorLayout } from '@/stores/editor-layout'

export function EditorHeader({ clip, onExport, exporting }: { clip: Clip; onExport: () => void; exporting: boolean }) {
  const mode = useEditor((s) => s.mode)
  const setMode = useEditor((s) => s.setMode)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.history.past.length > 0 && !s.preview && !s.busy)
  const canRedo = useEditor((s) => s.history.future.length > 0 && !s.preview && !s.busy)
  const ro = useEditor((s) => !!s.preview || !!s.busy || s.viewOnly)
  const revision = useEditor((s) => s.revision)
  const suggested = useEditor((s) => totals(viewTimeline(s)).suggested)
  const helpOpen = useEditor((s) => s.helpOpen)
  const setHelpOpen = useEditor((s) => s.setHelpOpen)
  const layout = useEditorLayout()
  const [revOpen, setRevOpen] = useState(false)
  return (
    <header className="ed-head" data-testid="editor-header">
      <div className="ed-head-left">
        <Tooltip content="Back to this project's clips" side="bottom">
          <Link href={`/projects/${clip.content_item_id}/clips`} className="icon-button ed-back" aria-label="Back to the project's clips" data-testid="editor-back">
            <ArrowLeft size={16} />
          </Link>
        </Tooltip>
        <div className="ed-title-block">
          <span className="ed-eyebrow">
            <Clapperboard size={11} /> {clip.kind === 'full' ? 'Full cut' : 'Short'} · Clip editor
          </span>
          <ClipTitle clip={clip} />
        </div>
      </div>

      <nav className="ed-modes" aria-label="Workspace">
        <button type="button" className={mode === 'edit' ? 'active' : ''} aria-current={mode === 'edit'} onClick={() => setMode('edit')} data-testid="mode-edit">
          Edit
        </button>
        <button type="button" className={mode === 'preview' ? 'active' : ''} aria-current={mode === 'preview'} onClick={() => setMode('preview')} data-testid="mode-preview">
          Preview
        </button>
      </nav>

      <div className="ed-head-right">
        <PresenceStack itemId={clip.content_item_id} where={`editor:${clip.id}`} />
        <SaveStatus />
        <div className="ed-sep" />
        {mode === 'edit' && (
          <>
            <IconButton label={layout.leftOpen ? 'Hide the side panel' : 'Show the side panel'} onClick={layout.toggleLeft} aria-pressed={layout.leftOpen} data-testid="toggle-left">
              <PanelLeft size={15} />
            </IconButton>
            <IconButton label={layout.rightOpen ? 'Hide the inspector' : 'Show the inspector'} onClick={layout.toggleRight} aria-pressed={layout.rightOpen} data-testid="toggle-right">
              <PanelRight size={15} />
            </IconButton>
            <IconButton label="Reset the panel layout" onClick={layout.reset} data-testid="reset-layout">
              <RotateCcw size={14} />
            </IconButton>
            <div className="ed-sep" />
          </>
        )}
        <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} data-testid="header-undo">
          <Undo2 size={15} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} data-testid="header-redo">
          <Redo2 size={15} />
        </IconButton>
        <Popover.Root open={revOpen} onOpenChange={setRevOpen}>
          <Popover.Trigger className="button button-secondary button-sm ed-rev" data-testid="revision-menu" aria-label="Revision history">
            <History size={13} /> Rev <span className="mono" data-testid="revision-number">{revision}</span> <ChevronDown size={12} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 70 }}>
              <Popover.Popup className="popover rev-popover">
                <div className="popover-head">
                  <b>Revision history</b>
                  <small>Every save is a revision. Restoring one creates a new revision, so nothing is lost.</small>
                </div>
                <RevisionList clipId={clip.id} onPick={() => setRevOpen(false)} />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <Button size="sm" variant="secondary" disabled={ro || suggested === 0} onClick={() => acceptAllLayers()} data-testid="accept-all">
          <Check size={13} /> Accept all{suggested > 0 && <span className="ed-count">{suggested}</span>}
        </Button>
        <StaleHint clipId={clip.id} />
        <Popover.Root open={helpOpen} onOpenChange={setHelpOpen}>
          <Popover.Trigger className="icon-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" data-testid="shortcuts-button">
            <Keyboard size={15} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 70 }}>
              <Popover.Popup className="popover shortcuts-popover" data-testid="shortcuts">
                <div className="popover-head">
                  <b>Keyboard shortcuts</b>
                </div>
                <dl>
                  {SHORTCUTS.map((s) => (
                    <div key={s.keys}>
                      <dt>
                        <kbd>{s.keys}</kbd>
                      </dt>
                      <dd>{s.what}</dd>
                    </div>
                  ))}
                </dl>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <Button size="sm" onClick={onExport} loading={exporting} data-testid="editor-export">
          <Send size={13} /> Export
        </Button>
      </div>
    </header>
  )
}

/** Hint when the newest finished render was made from an older revision than the one open here. */
function StaleHint({ clipId }: { clipId: string }) {
  const renders = useClipRenders(clipId)
  const revision = useEditor((s) => s.revision)
  const dirty = useEditor((s) => s.dirty)
  const done = (renders.data ?? []).filter((r) => r.status === 'done')
  const latest = done[0]
  if (!latest) return null
  const stale = (latest.edit_revision ?? 0) < revision || latest.stale || dirty
  if (!stale) return null
  return (
    <Tooltip content={`Your newest render is from revision ${latest.edit_revision ?? '?'}. Export again to include the changes since then (now revision ${revision}${dirty ? ', plus unsaved edits' : ''}).`} side="bottom">
      <span className="stale-hint" tabIndex={0} data-testid="stale-render-hint">
        <AlertTriangle size={12} /> Render out of date
      </span>
    </Tooltip>
  )
}

function ClipTitle({ clip }: { clip: Clip }) {
  const patch = usePatchClip()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useResettable(clip.title, clip.title)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])
  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === clip.title) return setDraft(clip.title)
    patch.mutate({ id: clip.id, patch: { title: next } }, { onError: () => setDraft(clip.title) })
  }
  if (editing) {
    return (
      <form
        className="ed-title-edit"
        onSubmit={(e) => {
          e.preventDefault()
          commit()
        }}
      >
        <input ref={input} className="title-input" value={draft} maxLength={120} aria-label="Clip title" data-testid="clip-title-input" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Escape' && (setDraft(clip.title), setEditing(false))} />
        <button type="submit" className="icon-button" aria-label="Save title" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
          <Check size={14} />
        </button>
        <button type="button" className="icon-button" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => (setDraft(clip.title), setEditing(false))}>
          <X size={14} />
        </button>
      </form>
    )
  }
  return (
    <div className="ed-title-row">
      <h1 className="ed-title truncate" title={clip.title} data-testid="clip-title">
        {stripDemo(clip.title)}
      </h1>
      {isDemoTitle(clip.title) && <ProvenanceBadge source="demo" />}
      {clip.provenance_by_part?.title && clip.provenance_by_part.title.source !== 'demo' && <ProvenanceBadge {...clip.provenance_by_part.title} />}
      <button type="button" className="icon-button ed-pencil" aria-label="Rename the clip" title="Rename" onClick={() => setEditing(true)} data-testid="rename-clip">
        {patch.isPending ? <Loader2 size={13} className="spin" /> : <Pencil size={13} />}
      </button>
    </div>
  )
}
