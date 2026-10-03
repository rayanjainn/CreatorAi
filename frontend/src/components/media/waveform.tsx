'use client'

import { useMemo } from 'react'
import { formatTimecode } from '@/lib/format'

/**
 * Loudness curve from the analysis `energy` array (dB per 0.5 s, about -70..0). Click to seek; silences are shaded.
 * Pure SVG: no audio decoding in the browser.
 */
export function Waveform({
  energy,
  step = 0.5,
  silences,
  currentTime,
  onSeek,
}: {
  energy: number[]
  step?: number
  silences?: [number, number][]
  currentTime: number
  onSeek: (t: number) => void
}) {
  const total = energy.length * step
  const bars = useMemo(() => {
    const max = 90
    const buckets = Math.min(energy.length, 240)
    const per = energy.length / buckets
    return Array.from({ length: buckets }, (_, i) => {
      const slice = energy.slice(Math.floor(i * per), Math.max(Math.floor(i * per) + 1, Math.floor((i + 1) * per)))
      const db = Math.max(...slice)
      return Math.max(2, Math.round(((Math.max(-60, Math.min(0, db)) + 60) / 60) * max))
    })
  }, [energy])
  if (!energy.length) return null
  return (
    <div className="waveform" data-testid="waveform">
      <svg
        viewBox={`0 0 ${bars.length} 100`}
        preserveAspectRatio="none"
        role="slider"
        tabIndex={0}
        aria-label="Loudness. Click to jump."
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatTimecode(currentTime)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onSeek(((e.clientX - r.left) / r.width) * total)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(total, currentTime + 2))
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 2))
        }}
      >
        {silences?.map(([a, b], i) => (
          <rect key={i} x={(a / total) * bars.length} width={Math.max(0.5, ((b - a) / total) * bars.length)} y={0} height={100} className="wf-silence" />
        ))}
        {bars.map((h, i) => (
          <rect key={i} x={i + 0.15} width={0.7} y={50 - h / 2} height={h} rx={0.3} className="wf-bar" />
        ))}
        <rect x={(currentTime / total) * bars.length} width={0.45} y={0} height={100} className="wf-head" />
      </svg>
      <div className="wf-legend">
        <span className="wf-swatch silence" /> silence
      </div>
    </div>
  )
}
