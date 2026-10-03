'use client'

import { memo } from 'react'
import { HEADER_W, RULER_H, rulerLabel, rulerStep } from './geometry'

export const Ruler = memo(function Ruler({ duration, pps, width, onPointerDown }: { duration: number; pps: number; width: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const { major, minor } = rulerStep(pps)
  const end = Math.max(duration, (width - HEADER_W) / pps)
  const ticks: { t: number; major: boolean }[] = []
  const count = Math.min(2000, Math.ceil(end / minor))
  for (let i = 0; i <= count; i++) {
    const t = Math.round(i * minor * 1000) / 1000
    ticks.push({ t, major: Math.abs(t / major - Math.round(t / major)) < 1e-6 })
  }
  return (
    <div className="tl-ruler" style={{ height: RULER_H, width }} onPointerDown={onPointerDown} data-testid="ruler" title="Click or drag to move the playhead">
      <div className="tl-ruler-corner" style={{ width: HEADER_W }} />
      {ticks.map(({ t, major: isMajor }) => (
        <span key={t} className={`tick ${isMajor ? 'tick-major' : ''}`} style={{ left: HEADER_W + t * pps }}>
          {isMajor && <em>{rulerLabel(t, major)}</em>}
        </span>
      ))}
      <div className="tl-ruler-end" style={{ left: HEADER_W + duration * pps, width: Math.max(0, width - HEADER_W - duration * pps) }} />
    </div>
  )
})
