'use client'

import { Camera, Link2Off } from 'lucide-react'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { formatDuration } from '@/lib/format'
import type { SceneIssue } from '@/lib/api/types'

/** Scenes with no or weak footage, each with a deterministic reshoot suggestion (rule-based, labelled heuristic). */
export function MissingScenes({ missing, weak }: { missing: SceneIssue[]; weak: SceneIssue[] }) {
  const all = [...missing, ...weak]
  if (!all.length) return null
  return (
    <section className="card" data-testid="missing-scenes">
      <div className="card-heading">
        <div>
          <div className="eyebrow amber-text">Needs footage</div>
          <h2>Missing and weak scenes</h2>
        </div>
      </div>
      <div className="missing-grid">
        {all.map((s) => (
          <article key={`${s.kind}-${s.scene_idx}`} className="missing-card" data-kind={s.kind} data-testid="missing-card">
            <div className="missing-top">
              <span className={`stat-icon ${s.kind === 'missing' ? 'red' : 'amber'}`} style={{ width: 30, height: 30 }}>
                {s.kind === 'missing' ? <Camera size={14} /> : <Link2Off size={14} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <b>
                  Scene {s.scene_idx + 1}: {s.title}
                </b>
                <small>
                  {s.kind === 'missing' ? 'No footage' : 'Weak match'} · about {formatDuration(s.est_sec) || `${s.est_sec}s`}
                </small>
              </div>
              <ProvenanceBadge {...s.provenance} />
            </div>
            <ul className="missing-beats">
              {s.beats.map((b) => (
                <li key={b}>“{b}”</li>
              ))}
            </ul>
            <p className="reshoot" data-testid="reshoot">
              {s.suggestion}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}
