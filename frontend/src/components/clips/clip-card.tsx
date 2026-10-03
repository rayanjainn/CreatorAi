'use client'

import Link from 'next/link'
import { Check, Clapperboard, Film, Scissors, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { VideoPlayer } from '@/components/media/video-player'
import { InlineText } from './inline-text'
import { useClipDecision, usePatchClip } from '@/lib/api/hooks'
import { formatDuration, formatRange } from '@/lib/format'
import type { Clip } from '@/lib/api/types'

function warningText(w: string): { label: string; detail: string } {
  if (w.startsWith('COPY_FALLBACK')) return { label: 'Fallback copy', detail: 'The AI was not available, so title, hook and caption come straight from the transcript. Edit them or regenerate with a provider configured.' }
  if (w.startsWith('SHORT_FOOTAGE')) return { label: 'Short footage', detail: 'Your footage had no window of the usual minimum length, so shorter clips were allowed.' }
  if (w.startsWith('NO_NEW_CLIPS')) return { label: 'No new clips', detail: 'Everything left overlaps clips you already accepted or rejected.' }
  return { label: w.split(':')[0], detail: w }
}

const STATUS_BADGE: Record<string, string> = { suggested: 'badge-gray', accepted: 'badge-green', rejected: 'badge-red' }

export function ClipCard({ clip, onRender, index = 0, projectTitle }: { clip: Clip; onRender: (c: Clip) => void; index?: number; projectTitle?: string }) {
  const patch = usePatchClip()
  const decide = useClipDecision()
  const parts = clip.provenance_by_part
  const save = (field: 'title' | 'hook' | 'caption') => (v: string) => patch.mutate({ id: clip.id, patch: { [field]: v } })
  const pct = Math.round(clip.score * 100)
  return (
    <motion.article
      className="clip-card"
      data-testid="clip-card"
      data-status={clip.status}
      data-kind={clip.kind}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.25 }}
    >
      <div className="clip-preview">
        <VideoPlayer compact src={clip.preview.url} poster={clip.thumbnail_url} start={clip.preview.start_sec} end={clip.preview.end_sec} label={`Preview of ${clip.title}`} />
        <div className="clip-badges">
          <span className="score-chip" title="Rule-based score from six transcript and audio features" data-testid="clip-score">
            {pct}
          </span>
          <span className="badge badge-gray">{clip.kind === 'full' ? 'Full cut' : 'Short'}</span>
          <span className={`badge ${STATUS_BADGE[clip.status]}`} data-testid="clip-status">
            {clip.status}
          </span>
        </div>
      </div>
      <div className="clip-body">
        {projectTitle && (
          <Link href={`/projects/${clip.content_item_id}/clips`} className="link small">
            {projectTitle}
          </Link>
        )}
        <InlineText label="Title" value={clip.title} onSave={save('title')} prov={parts.title} className="clip-title" testId="clip-title" />
        <InlineText label="Hook" value={clip.hook} onSave={save('hook')} prov={parts.hook} />
        <InlineText label="Caption" value={clip.caption} onSave={save('caption')} prov={parts.caption} multiline />
        <div className="clip-meta">
          <span className="mono" data-testid="clip-duration">
            <Film size={11} /> {formatDuration(clip.duration_sec)} ({clip.duration_sec.toFixed(1)}s)
          </span>
          <span className="mono">{formatRange(clip.start_sec, clip.end_sec)}</span>
          {parts.scores && <ProvenanceBadge {...parts.scores} label="Score" />}
        </div>
        {clip.reason && <p className="clip-reason">{clip.reason}</p>}
        {(clip.warnings ?? []).map((w) => {
          const t = warningText(w)
          return (
            <p key={w} className="clip-warning" title={t.detail} data-testid="clip-warning">
              <b>{t.label}.</b> {t.detail}
            </p>
          )
        })}
        <div className="clip-actions">
          {clip.status !== 'accepted' && (
            <Button size="sm" onClick={() => decide.mutate({ id: clip.id, action: 'accept' })} loading={decide.isPending && decide.variables?.action === 'accept'} data-testid="accept-clip">
              <Check size={13} /> Accept
            </Button>
          )}
          {clip.status !== 'rejected' && (
            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: clip.id, action: 'reject' })} loading={decide.isPending && decide.variables?.action === 'reject'} data-testid="reject-clip">
              <X size={13} /> Reject
            </Button>
          )}
          <Link href={`/editor/${clip.id}`} className="button button-secondary button-sm" data-testid="open-editor">
            <Scissors size={13} /> Open in editor
          </Link>
          <Button size="sm" variant="secondary" onClick={() => onRender(clip)} data-testid="render-clip">
            <Clapperboard size={13} /> Render
          </Button>
        </div>
      </div>
    </motion.article>
  )
}
