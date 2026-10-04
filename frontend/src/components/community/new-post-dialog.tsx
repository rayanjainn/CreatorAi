'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Send } from 'lucide-react'
import { Segmented } from '@/components/common/segmented'
import { Thumb } from '@/components/common/thumb'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { isApiError } from '@/lib/api/errors'
import { useAllRenders, useAssets, useCreatePost } from '@/lib/api/hooks'
import { PRESETS } from '@/lib/render-presets'
import { formatDuration } from '@/lib/format'
import { PlatformPicker } from './platforms'
import type { CommunityPlatform, RenderPreset } from '@/lib/api/types'

type Source = 'render' | 'video'

const PRESET_PLATFORM: Partial<Record<RenderPreset, CommunityPlatform>> = { yt_short: 'youtube', yt_long: 'youtube', reels: 'instagram', tiktok: 'tiktok' }

export function parseTags(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean)
}

/**
 * Share finished work with everyone on this server: a render (or a ready library video), a title, what feedback you want, and the
 * platforms it is meant for. `renderId` preselects a render (the "Share" button on a render row).
 */
export function NewPostDialog({ open, onOpenChange, renderId }: { open: boolean; onOpenChange: (o: boolean) => void; renderId?: string | null }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" eyebrow="Community" title="Share your work" description="Everyone with an account on this server sees community posts and can comment on them.">
      {open && <PostForm key={renderId ?? 'new'} renderId={renderId} onDone={() => onOpenChange(false)} />}
    </Modal>
  )
}

function PostForm({ renderId, onDone }: { renderId?: string | null; onDone: () => void }) {
  const router = useRouter()
  const renders = useAllRenders({ status: 'done' })
  const [source, setSource] = useState<Source>('render')
  const videos = useAssets({ kind: 'video', status: 'ready', limit: 100 }, { enabled: source === 'video' })
  const [picked, setPicked] = useState<string>(renderId ?? '')
  const [assetId, setAssetId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [platforms, setPlatforms] = useState<CommunityPlatform[] | null>(null)
  const create = useCreatePost()

  const renderList = renders.data ?? []
  const chosenRender = renderList.find((r) => r.id === (picked || renderList[0]?.id))
  const renderChoice = picked || renderList[0]?.id || ''
  const suggested = chosenRender && PRESET_PLATFORM[chosenRender.preset] ? [PRESET_PLATFORM[chosenRender.preset]!] : []
  const shownPlatforms = platforms ?? (source === 'render' ? suggested : [])
  const can = source === 'render' ? !!renderChoice : !!assetId
  const err = create.error && isApiError(create.error) ? create.error.message : null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!can) return
    create.mutate(
      {
        render_id: source === 'render' ? renderChoice : null,
        asset_id: source === 'video' ? assetId : null,
        title: title.trim() || null,
        body,
        platforms: shownPlatforms,
        tags: parseTags(tags),
      },
      {
        onSuccess: (post) => {
          onDone()
          router.push(`/community/${post.id}`)
        },
      },
    )
  }

  return (
    <form className="cp-form" onSubmit={submit} data-testid="new-post-form">
      <Segmented<Source>
        label="What to share"
        value={source}
        onChange={setSource}
        options={[
          { value: 'render', label: 'A finished render' },
          { value: 'video', label: 'A library video' },
        ]}
      />
      {source === 'render' ? (
        <Field label="Render" htmlFor="cp-render" hint={renders.isPending ? 'Loading your renders…' : renderList.length ? 'Exports from your projects (Clips > Export).' : undefined} error={!renders.isPending && !renderList.length ? 'No finished renders yet. Export a clip first, or share a library video.' : null}>
          <div className="cp-source">
            {chosenRender && <Thumb src={chosenRender.thumbnail_url} className="thumb cp-source-thumb" iconSize={16} />}
            <Select id="cp-render" value={renderChoice} onChange={(e) => setPicked(e.target.value)} disabled={!renderList.length} data-testid="post-render">
              {renderList.map((r) => (
                <option key={r.id} value={r.id}>
                  {(r.clip_title || 'Clip') + ' · ' + (PRESETS.find((p) => p.id === r.preset)?.label ?? r.preset) + ' · ' + formatDuration(r.duration_sec)}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      ) : (
        <Field label="Library video" htmlFor="cp-asset">
          <Select id="cp-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} data-testid="post-asset">
            <option value="">{videos.isPending ? 'Loading your videos…' : videos.data?.items.length ? 'Choose a video' : 'No ready videos in your library yet'}</option>
            {videos.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.filename} · {formatDuration(a.duration_sec)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Title" htmlFor="cp-title" hint={source === 'render' && chosenRender ? `Leave empty to use “${chosenRender.clip_title ?? 'the clip title'}”.` : undefined}>
        <Input id="cp-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="What is this?" data-testid="post-title" />
      </Field>
      <Field label="What feedback do you want?" htmlFor="cp-body">
        <Textarea id="cp-body" rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Does the hook land in the first two seconds? Is the caption readable on a phone?" data-testid="post-body" />
      </Field>
      <Field label="Made for">
        <PlatformPicker value={shownPlatforms} onChange={setPlatforms} />
      </Field>
      <Field label="Tags" htmlFor="cp-tags" hint="Comma or space separated, e.g. #tutorial #editing">
        <Input id="cp-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#tutorial #editing" data-testid="post-tags" />
      </Field>
      {err && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
      <div className="modal-foot" style={{ padding: 0, marginTop: 4 }}>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!can} loading={create.isPending} data-testid="post-submit">
          <Send size={14} /> Post
        </Button>
      </div>
    </form>
  )
}
