'use client'

import { useState, type FormEvent } from 'react'
import { Check, MessageSquare, Trash2, Undo2 } from 'lucide-react'
import { Avatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { useAddComment, useComments, useDeleteComment, usePatchComment } from '@/lib/api/hooks'
import { relativeTime } from '@/lib/time'
import { useRole } from '@/lib/use-role'
import type { Comment } from '@/lib/api/types'

const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Discussion on a project, or on one clip when `clipId` is given. `atSec` (the playhead) lets a note point at a moment; clicking the
 * time chip calls `onSeek`. Anyone who can open the project can comment, including viewers.
 */
export function CommentsPanel({ itemId, clipId, atSec, onSeek }: { itemId: string; clipId?: string | null; atSec?: number; onSeek?: (s: number) => void }) {
  const { canEdit } = useRole()
  const list = useComments(itemId, clipId)
  const add = useAddComment(itemId)
  const patch = usePatchComment()
  const del = useDeleteComment()
  const [text, setText] = useState('')
  const [pin, setPin] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  const all = list.data ?? []
  const open = all.filter((c) => !c.resolved)
  const done = all.filter((c) => c.resolved)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    add.mutate({ body, clip_id: clipId ?? null, at_sec: pin && atSec != null ? Math.round(atSec * 10) / 10 : null }, { onSuccess: () => setText('') })
  }

  const row = (c: Comment) => (
    <li key={c.id} className={c.resolved ? 'cm resolved' : 'cm'} data-testid="comment">
      <Avatar id={c.author_id} name={c.author_name} size="sm" />
      <div className="cm-body">
        <div className="cm-meta">
          <b>{c.author_name}</b>
          <small>{relativeTime(c.created_at)}</small>
          {c.at_sec != null && (
            <button type="button" className="cm-time" onClick={() => onSeek?.(c.at_sec!)} disabled={!onSeek} title="Jump to this moment">
              {stamp(c.at_sec)}
            </button>
          )}
        </div>
        <p>{c.body}</p>
        <div className="cm-actions">
          {(canEdit || c.mine) && (
            <button type="button" onClick={() => patch.mutate({ id: c.id, resolved: !c.resolved })}>
              {c.resolved ? (
                <>
                  <Undo2 size={12} /> Reopen
                </>
              ) : (
                <>
                  <Check size={12} /> Resolve
                </>
              )}
            </button>
          )}
          {c.mine && (
            <button type="button" onClick={() => del.mutate(c.id)} aria-label="Delete comment">
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </div>
    </li>
  )

  return (
    <section className="comments" data-testid="comments-panel" aria-label="Comments">
      <form onSubmit={submit} className="cm-form">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave a note for the team…" rows={2} maxLength={2000} aria-label="New comment" data-testid="comment-input" />
        <div className="cm-form-row">
          {atSec != null && (
            <label className="cm-pin">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> At {stamp(atSec)}
            </label>
          )}
          <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()} data-testid="comment-send">
            Comment
          </Button>
        </div>
      </form>
      {list.isPending ? (
        <p className="muted small">Loading…</p>
      ) : open.length === 0 && done.length === 0 ? (
        <p className="cm-empty">
          <MessageSquare size={16} aria-hidden /> No comments yet.
        </p>
      ) : (
        <ul className="cm-list">{open.map(row)}</ul>
      )}
      {done.length > 0 && (
        <>
          <button type="button" className="cm-toggle" onClick={() => setShowResolved((s) => !s)} aria-expanded={showResolved}>
            {showResolved ? 'Hide' : 'Show'} {done.length} resolved
          </button>
          {showResolved && <ul className="cm-list">{done.map(row)}</ul>}
        </>
      )}
    </section>
  )
}
