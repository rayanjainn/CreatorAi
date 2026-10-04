'use client'

import Link from 'next/link'
import { Heart, MessageCircle } from 'lucide-react'
import { Avatar } from '@/components/common/avatar'
import { Thumb } from '@/components/common/thumb'
import { useLikePost } from '@/lib/api/hooks'
import { formatDuration } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { PlatformBadges } from './platforms'
import type { CommunityPost } from '@/lib/api/types'

export function LikeButton({ post, size = 'md' }: { post: CommunityPost; size?: 'sm' | 'md' }) {
  const like = useLikePost()
  return (
    <button
      type="button"
      className={cn('cp-like', post.liked_by_me && 'on', size === 'sm' && 'sm')}
      aria-pressed={post.liked_by_me}
      aria-label={post.liked_by_me ? 'Unlike' : 'Like'}
      onClick={(e) => {
        e.preventDefault()
        like.mutate({ id: post.id, liked: !post.liked_by_me })
      }}
      data-testid="like"
    >
      <Heart size={size === 'sm' ? 14 : 16} fill={post.liked_by_me ? 'currentColor' : 'none'} aria-hidden />
      <span data-testid="like-count">{post.like_count}</span>
    </button>
  )
}

/** One post in the feed: poster, title, who and when, platforms, likes and comments. */
export function PostCard({ post }: { post: CommunityPost }) {
  const tall = post.aspect === '9:16'
  return (
    <article className="cp-card" data-testid="post-card" data-post={post.id}>
      <Link href={`/community/${post.id}`} className="cp-card-media" aria-label={`Open “${post.title}”`}>
        <Thumb src={post.thumbnail_url} className={cn('thumb', tall && 'cp-tall')} iconSize={22} />
        {post.duration_sec ? <span className="dur-chip">{formatDuration(post.duration_sec)}</span> : null}
      </Link>
      <div className="cp-card-body">
        <Link href={`/community/${post.id}`} className="cp-card-title">
          {post.title}
        </Link>
        <div className="cp-byline">
          <Avatar id={post.author.id ?? post.id} name={post.author.name} size="sm" />
          <span className="truncate">
            <b>{post.author.name}</b>
            {post.mine && <span className="badge badge-gray cp-you">You</span>}
          </span>
          <small>{relativeTime(post.created_at)}</small>
        </div>
        <PlatformBadges platforms={post.platforms} />
        <div className="cp-card-foot">
          <LikeButton post={post} size="sm" />
          <Link href={`/community/${post.id}#comments`} className="cp-count" aria-label={`${post.comment_count} comments`}>
            <MessageCircle size={14} aria-hidden /> <span data-testid="comment-count">{post.comment_count}</span>
          </Link>
        </div>
      </div>
    </article>
  )
}
