'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, Lightbulb, Megaphone, ShieldAlert, Sparkles } from 'lucide-react'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { CopyButton } from '@/components/common/copy-button'
import { PLATFORMS } from './director-form'
import { formatDuration } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import type { Plan } from '@/lib/api/types'

const COLORS = ['var(--primary)', 'var(--amber)', 'var(--cyan)', 'var(--pink)', 'var(--teal)', '#a3e635', '#fb923c']

/** Angle, timed structure, storytelling tips, hook ideas, CTA and risks of one plan version. */
export function PlanView({ plan, projectId }: { plan: Plan; projectId: string }) {
  const p = plan.plan
  const total = p.structure.reduce((a, s) => a + s.duration_sec, 0) || 1
  const platform = PLATFORMS.find((x) => x.value === plan.inputs.platform)?.label ?? plan.inputs.platform
  return (
    <section className="card plan-view" data-testid="plan-view">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Plan · v{plan.version}</div>
          <h2>The angle</h2>
        </div>
        <div className="plan-meta">
          <ProvenanceBadge {...plan.provenance} />
          <span className="muted small">{relativeTime(plan.created_at)}</span>
        </div>
      </div>
      <blockquote className="plan-angle" data-testid="plan-angle">
        {p.angle}
      </blockquote>
      <div className="chip-row plan-chips">
        {platform && <span className="badge badge-gray">{platform}</span>}
        {plan.inputs.target_duration_sec ? <span className="badge badge-gray">{formatDuration(plan.inputs.target_duration_sec)} target</span> : null}
        {p.domain && <span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{p.domain}</span>}
        {p.audience && <span className="badge badge-gray">For {p.audience}</span>}
      </div>

      {plan.fixups.length > 0 && (
        <div className="notice notice-amber" data-testid="plan-fixups">
          <div className="stat-icon amber">
            <AlertTriangle size={15} />
          </div>
          <div className="notice-body">
            <b>The server adjusted this plan</b>
            {plan.fixups.map((f) => (
              <p key={f}>{f}</p>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="sub-h">Structure · {formatDuration(total)}</h3>
        <div className="structure-bar" role="img" aria-label="Section durations">
          {p.structure.map((s, i) => (
            <div key={`${s.section}-${i}`} className="structure-seg" style={{ width: `${(s.duration_sec / total) * 100}%`, background: COLORS[i % COLORS.length] }} title={`${s.section}: ${s.duration_sec}s`} />
          ))}
        </div>
        <ol className="structure-list">
          {p.structure.map((s, i) => (
            <li key={`${s.section}-${i}`}>
              <span className="structure-dot" style={{ background: COLORS[i % COLORS.length] }} />
              <div>
                <b>{s.section}</b>
                <span className="muted"> · {s.duration_sec}s</span>
                {s.goal && <p>{s.goal}</p>}
                {s.notes && <small>{s.notes}</small>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="plan-cols">
        <div>
          <h3 className="sub-h">
            <Sparkles size={12} /> Storytelling tips
          </h3>
          <ul className="bullets">
            {p.storytelling.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="sub-h">
            <ShieldAlert size={12} /> Risks to avoid
          </h3>
          <ul className="bullets warn">
            {p.risks.length ? p.risks.map((t) => <li key={t}>{t}</li>) : <li className="muted">None flagged.</li>}
          </ul>
        </div>
      </div>

      <div>
        <h3 className="sub-h">
          <Lightbulb size={12} /> Hook ideas
        </h3>
        <ul className="hook-ideas">
          {p.hook_ideas.map((h) => (
            <li key={h}>
              <span>{h}</span>
              <CopyButton text={h} label="Copy hook" />
            </li>
          ))}
        </ul>
        <Link href={`/projects/${projectId}/script`} className="link small">
          Pick a hook and write the script <ArrowRight size={11} style={{ verticalAlign: -1 }} />
        </Link>
      </div>

      <div className="cta-box">
        <Megaphone size={15} aria-hidden />
        <div>
          <small>Call to action</small>
          <p>{p.cta}</p>
        </div>
        <CopyButton text={p.cta} label="Copy CTA" />
      </div>
    </section>
  )
}
