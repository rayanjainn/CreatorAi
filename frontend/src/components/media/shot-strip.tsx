'use client'

import { Thumb } from '@/components/common/thumb'
import { formatRange, formatTimecode } from '@/lib/format'
import type { Shot } from '@/lib/api/types'

/** Shots as keyframe cards (with AI captions when available). Click to seek; the playing shot is highlighted. */
export function ShotStrip({ shots, duration, currentTime, onSeek }: { shots: Shot[]; duration: number | null; currentTime: number; onSeek: (t: number) => void }) {
  const total = duration && duration > 0 ? duration : (shots.at(-1)?.end_sec ?? 1)
  const active = shots.find((s) => currentTime >= s.start_sec && currentTime < s.end_sec)?.idx
  return (
    <div data-testid="shot-strip">
      <div className="shot-bar" role="presentation">
        {shots.map((s) => (
          <button
            key={s.idx}
            type="button"
            className="shot-seg"
            data-active={s.idx === active}
            style={{ width: `${((s.end_sec - s.start_sec) / total) * 100}%` }}
            onClick={() => onSeek(s.start_sec)}
            aria-label={`Shot ${s.idx + 1}, ${formatRange(s.start_sec, s.end_sec)}`}
            title={`Shot ${s.idx + 1} · ${formatRange(s.start_sec, s.end_sec)}`}
          />
        ))}
      </div>
      <div className="shot-grid">
        {shots.map((s) => (
          <button key={s.idx} type="button" className="shot-card" data-active={s.idx === active} onClick={() => onSeek(s.start_sec)} data-testid="shot-card">
            <Thumb src={s.keyframe_url} iconSize={18}>
              <span className="shot-time mono">{formatTimecode(s.start_sec)}</span>
            </Thumb>
            <div className="shot-body">
              <small className="mono">{formatRange(s.start_sec, s.end_sec)}</small>
              {s.caption ? <p>{s.caption}</p> : <p className="muted">No visual caption</p>}
              {s.tags.length > 0 && (
                <div className="tag-row">
                  {s.tags.slice(0, 4).map((t) => (
                    <span key={t} className="badge badge-gray">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
