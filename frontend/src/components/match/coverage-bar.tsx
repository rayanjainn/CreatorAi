'use client'

import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { formatDuration } from '@/lib/format'
import type { Match } from '@/lib/api/types'

const SEGMENTS: { key: 'confirmed' | 'matched' | 'weak' | 'missing' | 'rejected' | 'unmatched'; label: string; color: string }[] = [
  { key: 'confirmed', label: 'Confirmed', color: 'var(--cyan)' },
  { key: 'matched', label: 'Matched', color: 'var(--green)' },
  { key: 'weak', label: 'Weak', color: 'var(--amber)' },
  { key: 'missing', label: 'Missing', color: 'var(--red)' },
  { key: 'rejected', label: 'Rejected', color: '#71717a' },
  { key: 'unmatched', label: 'Not matched yet', color: '#3f3f46' },
]

/** Coverage summary: percent, segmented bar by beat status, legend with counts. */
export function CoverageBar({ match }: { match: Match }) {
  const c = match.coverage
  const total = c.total || 1
  return (
    <div className="coverage" data-testid="coverage">
      <div className="coverage-head">
        <div>
          <div className="coverage-pct mono" data-testid="coverage-pct">
            {c.coverage_pct == null ? '–' : `${Math.round(c.coverage_pct)}%`}
          </div>
          <small>script covered · {c.total} beats{c.matched_sec ? ` · ${formatDuration(c.matched_sec)} of footage used` : ''}</small>
        </div>
        <div className="coverage-prov">
          <ProvenanceBadge {...match.provenance} />
          {match.embedder.real === false && <small>Hashing embedder: matches are keyword-grade estimates.</small>}
        </div>
      </div>
      <div className="coverage-bar" role="img" aria-label={`Coverage ${Math.round(c.coverage_pct ?? 0)} percent`}>
        {SEGMENTS.filter((s) => c[s.key] > 0).map((s) => (
          <div key={s.key} style={{ width: `${(c[s.key] / total) * 100}%`, background: s.color }} title={`${s.label}: ${c[s.key]}`} />
        ))}
      </div>
      <ul className="coverage-legend">
        {SEGMENTS.filter((s) => c[s.key] > 0).map((s) => (
          <li key={s.key} data-testid={`cov-${s.key}`}>
            <i style={{ background: s.color }} /> {s.label} <b>{c[s.key]}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
