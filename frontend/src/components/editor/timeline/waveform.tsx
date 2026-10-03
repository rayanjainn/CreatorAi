'use client'

import { memo, useMemo } from 'react'

/** Bars for `[srcIn, srcOut]` of an asset's loudness curve (dB per `window` s). Honest empty state when there is no data. */
export const Waveform = memo(function Waveform({ energy, windowSec, srcIn, srcOut, width, height }: { energy: number[]; windowSec: number; srcIn: number; srcOut: number; width: number; height: number }) {
  const bars = useMemo(() => {
    if (!energy.length || width < 4) return null
    const step = 3
    const n = Math.max(1, Math.floor(width / step))
    const out: number[] = []
    const span = srcOut - srcIn
    for (let i = 0; i < n; i++) {
      const a = srcIn + (i / n) * span
      const b = srcIn + ((i + 1) / n) * span
      const lo = Math.max(0, Math.floor(a / windowSec))
      const hi = Math.min(energy.length - 1, Math.max(lo, Math.floor((b - 1e-6) / windowSec)))
      let peak = -90
      for (let k = lo; k <= hi; k++) peak = Math.max(peak, energy[k] ?? -90)
      // -55 dB (near silence) .. -6 dB (loud) -> 0.08 .. 1
      out.push(Math.max(0.06, Math.min(1, (peak + 55) / 49)))
    }
    return out
  }, [energy, windowSec, srcIn, srcOut, width])
  if (!bars) {
    return (
      <svg className="wave wave-empty" width={width} height={height} aria-hidden>
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} />
      </svg>
    )
  }
  const mid = height / 2
  return (
    <svg className="wave" width={width} height={height} viewBox={`0 0 ${bars.length * 3} ${height}`} preserveAspectRatio="none" aria-hidden>
      {bars.map((v, i) => (
        <rect key={i} x={i * 3} y={mid - (v * height * 0.46)} width={2} height={Math.max(1.5, v * height * 0.92)} rx={1} />
      ))}
    </svg>
  )
})
