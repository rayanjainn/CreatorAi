'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { parseTags } from '@/components/community/new-post-dialog'
import { PlatformBadges, PlatformPicker } from '@/components/community/platforms'
import { LikeButton } from '@/components/community/post-card'
import { PostComments } from '@/components/community/post-comments'
import { VideoPlayer } from '@/components/media/video-player'
import { Button, LinkButton } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { isCode } from '@/lib/api/errors'
import { useCommunityPost, useDeletePost, usePatchPost } from '@/lib/api/hooks'
import { formatDuration } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { CommunityPlatform, CommunityPost } from '@/lib/api/types'

export default function PostPage() {
  const { id } = useParams<{ id: string }>()
  const post = useCommunityPost(id)
  if (post.isPending) return <div className="page"><Skeleton style={{ height: 480 }} /></div>
  if (post.isError) {
    return (
      <div className="page">
        {isCode(post.error, 'NOT_FOUND') ? (
          <EmptyState title="This post is gone" description="Its author deleted it." actions={<LinkButton href="/community">Back to the community</LinkButton>} />
        ) : (
          <ErrorState error={post.error} onRetry={() => void post.refetch()} />
        )}
      </div>
    )
  }
  return <PostView post={post.data} />
}

function PostView({ post }: { post: CommunityPost }) {
  const router = useRouter()
  const del = useDeletePost()
  const [confirm, setConfirm] = useState(false)
  const [editing, setEditing] = useState(false)
  const tall = post.aspect === '9:16'
  return (
    <div className="page" data-testid="post-page">
      <Link href="/community" className="link small cp-back">
        <ArrowLeft size={13} /> Community
      </Link>
      <div className={cn('cp-detail', tall && 'tall')}>
        <div className="cp-player">
          <VideoPlayer src={post.video_url} poster={post.thumbnail_url} label={`Video: ${post.title}`} />
        </div>
        <div className="cp-side">
          <div className="card cp-info">
            <h1 data-testid="post-title">{post.title}</h1>
            <div className="cp-byline">
              <Avatar id={post.author.id ?? post.id} name={post.author.name} />
              <span>
                <b>{post.author.name}</b>
                {post.workspace_name && <small className="muted"> · {post.workspace_name}</small>}
              </span>
              <small>{relativeTime(post.created_at)}</small>
            </div>
            <PlatformBadges platforms={post.platforms} />
            {post.body && <p className="cp-body" data-testid="post-body">{post.body}</p>}
            {post.tags.length > 0 && (
              <div className="cp-tags">
                {post.tags.map((t) => (
                  <span key={t} className="tag-chip">
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="cp-card-foot">
              <LikeButton post={post} />
              {post.duration_sec ? <span className="muted small mono">{formatDuration(post.duration_sec)} · {post.aspect ?? ''}</span> : null}
              {post.mine && (
                <span className="cp-owner">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="edit-post">
                    <Pencil size={13} /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} data-testid="delete-post">
                    <Trash2 size={13} /> Delete
                  </Button>
                </span>
              )}
            </div>
          </div>
          <PostComments postId={post.id} />
        </div>
      </div>
      <EditPostDialog post={post} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this post?"
        description="The post, its comments and likes are removed for everyone. Your render and library video are not touched."
        confirmLabel="Delete post"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate(post.id, { onSuccess: () => router.push('/community') })}
      />
    </div>
  )
}

function EditPostDialog({ post, open, onOpenChange }: { post: CommunityPost; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Edit post">
      {open && <EditForm post={post} onDone={() => onOpenChange(false)} />}
    </Modal>
  )
}

function EditForm({ post, onDone }: { post: CommunityPost; onDone: () => void }) {
  const patch = usePatchPost(post.id)
  const [title, setTitle] = useState(post.title)
  const [body, setBody] = useState(post.body)
  const [platforms, setPlatforms] = useState<CommunityPlatform[]>(post.platforms)
  const [tags, setTags] = useState(post.tags.map((t) => `#${t}`).join(' '))
  return (
    <form
      className="cp-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim()) patch.mutate({ title: title.trim(), body, platforms, tags: parseTags(tags) }, { onSuccess: onDone })
      }}
    >
      <Field label="Title" htmlFor="ep-title">
        <Input id="ep-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="ep-body">
        <Textarea id="ep-body" rows={4} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label="Made for">
        <PlatformPicker value={platforms} onChange={setPlatforms} />
      </Field>
      <Field label="Tags" htmlFor="ep-tags">
        <Input id="ep-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <div className="modal-foot" style={{ padding: 0 }}>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={patch.isPending} disabled={!title.trim()} data-testid="save-post">
          Save
        </Button>
      </div>
    </form>
  )
}
