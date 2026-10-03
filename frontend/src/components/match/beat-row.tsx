'use client'

import { useState } from 'react'
import { ArrowLeftRight, Check, Play, Repeat, X } from 'lucide-react'
import { Thumb } from '@/components/common/thumb'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { VideoPlayer } from '@/components/media/video-player'
import { useBeatDecision } from '@/lib/api/hooks'
import { formatRange } from '@/lib/format'
import type { BeatMatch } from '@/lib/api/types'

const STATUS: Record<string, { label: string; cls: string }> = {
  matched: { label: 'Matched', cls: 'badge-green' },
  confirmed: { label: 'Confirmed', cls: 'badge-cyan' },
  weak: { label: 'Weak', cls: 'badge-amber' },
  missing: { label: 'Missing', cls: 'badge-red' },
  rejected: { label: 'Rejected', cls: 'badge-gray' },
  unmatched: { label: 'Not matched', cls: 'badge-gray' },
}

export function BeatRow({ beat, projectId }: { beat: BeatMatch; projectId: string }) {
  const decide = useBeatDecision(projectId)
  const [playing, setPlaying] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const st = STATUS[beat.status] ?? STATUS.unmatched
  const hasSpan = beat.asset_id && beat.start_sec != null && beat.end_sec != null
  const alts = beat.alternatives ?? []
  const act = (action: 'confirm' | 'reject') => beat.match_id && decide.mutate({ matchId: beat.match_id, action })

  return (
    <li className="beat-row" data-testid="beat-row" data-status={beat.status} data-flags={[beat.out_of_order && 'out_of_order', beat.shared_span && 'shared_span'].filter(Boolean).join(' ')}>
      <div className="beat-text">
        <span className="beat-id mono">
          {beat.scene_idx + 1}.{beat.beat_idx + 1}
        </span>
        <p>{beat.text}</p>
        <small className="mono">{beat.est_sec.toFixed(1)}s</small>
      </div>
      <div className="beat-match">
        <div className="beat-match-top">
          <span className={`badge ${st.cls}`} data-testid="beat-status">
            {st.label}
          </span>
          {beat.out_of_order && (
            <Tooltip content="Its best footage sits earlier or later than the script order allows (a retake, or reordered footage).">
              <span className="badge badge-amber" tabIndex={0} data-testid="flag-out-of-order">
                out of order
              </span>
            </Tooltip>
          )}
          {beat.shared_span && (
            <Tooltip content="A neighbouring beat uses the same take. Beats are finer than transcript segments, so this is often fine.">
              <span className="badge badge-gray" tabIndex={0} data-testid="flag-shared-span">
                shared take
              </span>
            </Tooltip>
          )}
          {beat.provenance && <ProvenanceBadge {...beat.provenance} />}
          {hasSpan && (
            <span className="badge badge-gray mono" title="Cosine similarity of the beat and the matched transcript span" data-testid="beat-confidence">
              {Math.round((beat.confidence ?? 0) * 100)}% match
            </span>
          )}
        </div>
        {hasSpan ? (
          <div className="beat-span">
            {playing ? (
              <div className="beat-player">
                <VideoPlayer compact autoPlay src={beat.preview_url} poster={beat.thumbnail_url} start={beat.start_sec!} end={beat.end_sec!} label="Matched footage preview" />
              </div>
            ) : (
              <button type="button" className="beat-thumb" onClick={() => setPlaying(true)} aria-label="Play the matched footage" data-testid="beat-play">
                <Thumb src={beat.thumbnail_url} iconSize={18}>
                  <span className="moment-play" style={{ opacity: 1 }}>
                    <Play size={16} />
                  </span>
                </Thumb>
              </button>
            )}
            <div className="beat-span-info">
              <b className="mono" data-testid="beat-timecode">
                {formatRange(beat.start_sec, beat.end_sec)}
              </b>
              <small className="truncate">{beat.filename}</small>
              {beat.matched_text && <p>“{beat.matched_text}”</p>}
            </div>
          </div>
        ) : (
          <p className="muted small">{beat.status === 'rejected' ? 'You rejected this match.' : 'No footage says this yet.'}</p>
        )}
        <div className="beat-actions">
          {playing && (
            <Button size="sm" variant="ghost" onClick={() => setPlaying(false)}>
              Close preview
            </Button>
          )}
          {alts.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setSwapOpen(!swapOpen)} aria-expanded={swapOpen} data-testid="swap-toggle">
              <ArrowLeftRight size={13} /> Swap match ({alts.length})
            </Button>
          )}
          {hasSpan && beat.status !== 'confirmed' && (
            <Button size="sm" variant="secondary" onClick={() => act('confirm')} loading={decide.isPending && decide.variables?.action === 'confirm'} data-testid="confirm-beat">
              <Check size={13} /> Confirm
            </Button>
          )}
          {hasSpan && beat.status !== 'rejected' && (
            <Button size="sm" variant="ghost" onClick={() => act('reject')} loading={decide.isPending && decide.variables?.action === 'reject'} data-testid="reject-beat">
              <X size={13} /> Reject
            </Button>
          )}
        </div>
        {swapOpen && (
          <ul className="alt-list" data-testid="alt-list">
            {alts.map((a) => (
              <li key={a.index} data-current={a.is_current}>
                <Thumb src={a.thumbnail_url} iconSize={14} className="thumb alt-thumb" />
                <div>
                  <b className="mono">{a.timecode}</b>
                  <small className="truncate" style={{ display: 'block' }}>
                    {a.filename} · {Math.round(a.score * 100)}% {a.out_of_order ? '· out of order' : ''}
                  </small>
                  {a.text && <p>“{a.text}”</p>}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={a.is_current || !beat.match_id}
                  loading={decide.isPending && decide.variables?.alternative_index === a.index}
                  onClick={() => beat.match_id && decide.mutate({ matchId: beat.match_id, action: 'swap', alternative_index: a.index }, { onSuccess: () => setSwapOpen(false) })}
                  data-testid="use-alternative"
                >
                  <Repeat size={12} /> {a.is_current ? 'Current' : 'Use this'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}
