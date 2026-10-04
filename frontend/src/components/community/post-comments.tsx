'use client'

import { useState, type FormEvent } from 'react'
import { CornerDownRight, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { useAddCommunityComment, useCommunityComments, useDeleteCommunityComment, usePatchCommunityComment } from '@/lib/api/hooks'
import { relativeTime } from '@/lib/time'
import type { CommunityComment } from '@/lib/api/types'

/** Threads under a community post: comments with one level of replies. Anyone signed in can take part. */
export function PostComments({ postId }: { postId: string }) {
  const list = useCommunityComments(postId)
  const add = useAddCommunityComment(postId)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)

  const all = list.data ?? []
  const roots = all.filter((c) => !c.parent_id)
  const replies = (id: string) => all.filter((c) => c.parent_id === id)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (body) add.mutate({ body }, { onSuccess: () => setText('') })
  }

  return (
    <section className="comments cp-comments" id="comments" aria-label="Comments" data-testid="post-comments">
      <h3>
        Feedback <span className="muted">({all.length})</span>
      </h3>
      <form onSubmit={submit} className="cm-form">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What works, what would you change before posting it?" rows={3} maxLength={2000} aria-label="New comment" data-testid="community-comment-input" />
        <div className="cm-form-row">
          <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()} data-testid="community-comment-send">
            Comment
          </Button>
        </div>
      </form>
      {list.isPending ? (
        <p className="muted small">Loading…</p>
      ) : roots.length === 0 ? (
        <p className="cm-empty">
          <MessageSquare size={16} aria-hidden /> No feedback yet. Be the first.
        </p>
      ) : (
        <ul className="cm-list">
          {roots.map((c) => (
            <li key={c.id} className="cp-thread">
              <CommentRow postId={postId} c={c} onReply={() => setReplyTo(replyTo === c.id ? null : c.id)} />
              {(replies(c.id).length > 0 || replyTo === c.id) && (
                <ul className="cm-list cp-replies">
                  {replies(c.id).map((r) => (
                    <li key={r.id}>
                      <CommentRow postId={postId} c={r} />
                    </li>
                  ))}
                  {replyTo === c.id && (
                    <li>
                      <ReplyForm postId={postId} parentId={c.id} onDone={() => setReplyTo(null)} />
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CommentRow({ postId, c, onReply }: { postId: string; c: CommunityComment; onReply?: () => void }) {
  const patch = usePatchCommunityComment(postId)
  const del = useDeleteCommunityComment(postId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.body)
  return (
    <div className="cm" data-testid="community-comment" data-comment={c.id}>
      <Avatar id={c.author.id ?? c.id} name={c.author.name} size="sm" />
      <div className="cm-body">
        <div className="cm-meta">
          <b>{c.author.name}</b>
          {c.by_post_author && <span className="badge badge-gray">Author</span>}
          <small>{relativeTime(c.created_at)}</small>
          {c.updated_at !== c.created_at && <small>(edited)</small>}
        </div>
        {editing ? (
          <form
            className="cm-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) patch.mutate({ id: c.id, body: draft.trim() }, { onSuccess: () => setEditing(false) })
            }}
          >
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000} aria-label="Edit comment" />
            <div className="cm-form-row">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={patch.isPending} disabled={!draft.trim()}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p>{c.body}</p>
        )}
        <div className="cm-actions">
          {onReply && (
            <button type="button" onClick={onReply} data-testid="reply">
              <CornerDownRight size={12} /> Reply
            </button>
          )}
          {c.mine && !editing && (
            <button type="button" onClick={() => setEditing(true)}>
              <Pencil size={12} /> Edit
            </button>
          )}
          {c.can_delete && (
            <button type="button" onClick={() => del.mutate(c.id)} aria-label="Delete comment" data-testid="delete-comment">
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ReplyForm({ postId, parentId, onDone }: { postId: string; parentId: string; onDone: () => void }) {
  const add = useAddCommunityComment(postId)
  const [text, setText] = useState('')
  return (
    <form
      className="cm-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) add.mutate({ body: text.trim(), parent_id: parentId }, { onSuccess: onDone })
      }}
    >
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} autoFocus aria-label="Reply" data-testid="reply-input" />
      <div className="cm-form-row">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()} data-testid="reply-send">
          Reply
        </Button>
      </div>
    </form>
  )
}
