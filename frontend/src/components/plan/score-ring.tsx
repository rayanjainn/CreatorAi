/** Circular score (0-100). `null` renders an "unknown" ring instead of inventing a number. */
export function ScoreRing({ value, size = 64, label, stroke = 6 }: { value: number | null | undefined; size?: number; label?: string; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const known = value !== null && value !== undefined && Number.isFinite(value)
  const v = known ? Math.max(0, Math.min(100, value)) : 0
  const tone = !known ? 'var(--dim)' : v >= 75 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)'
  return (
    <div
      className="score-ring"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ? `${label}: ${known ? Math.round(v) : 'unknown'}` : known ? `Score ${Math.round(v)}` : 'Score unknown'}
      data-testid="score-ring"
      data-score={known ? Math.round(v) : 'unknown'}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={stroke} />
        {known && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        )}
      </svg>
      <span style={{ fontSize: size * 0.3, color: known ? '#fff' : 'var(--dim)' }}>{known ? Math.round(v) : '?'}</span>
    </div>
  )
}
