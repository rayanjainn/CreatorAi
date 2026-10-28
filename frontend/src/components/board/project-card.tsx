'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Clock3 } from 'lucide-react'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { StageBadge } from '@/components/common/stage-badge'
import { Thumb } from '@/components/common/thumb'
import type { Card } from '@/lib/api/types'
import { isDemoTitle, stripDemo } from '@/lib/format'
import { relativeTime } from '@/lib/time'

export function ProjectCard({ card, index = 0 }: { card: Card; index?: number }) {
  const demo = isDemoTitle(card.title)
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.25 }} whileHover={{ y: -3 }} style={{ height: '100%' }}>
      <Link href={`/projects/${card.id}`} className="project-card" data-testid="project-card" aria-label={stripDemo(card.title)}>
        <Thumb src={card.thumbnail_url}>
          <div className="thumb-overlay" />
          <StageBadge stage={card.stage} />
          {demo && <ProvenanceBadge source="demo" />}
        </Thumb>
        <div className="project-info">
          <div className="meta">
            <span>
              <Clock3 size={11} aria-hidden /> {relativeTime(card.updated_at)}
            </span>
            {card.running_jobs.active && (
              <span style={{ color: 'var(--accent-text)' }}>
                <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} aria-hidden /> working
              </span>
            )}
          </div>
          <h3>{stripDemo(card.title)}</h3>
          <p>{card.idea_text || card.objective || 'No notes yet.'}</p>
          <div className="progress-label">
            <span>Production checklist</span>
            <b>{card.progress.percent}%</b>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={card.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist progress">
            <i style={{ width: `${card.progress.percent}%` }} />
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export function ProjectRow({ card }: { card: Card }) {
  const demo = isDemoTitle(card.title)
  return (
    <Link href={`/projects/${card.id}`} className="project-row" data-testid="project-row">
      <Thumb src={card.thumbnail_url} iconSize={18} />
      <div style={{ minWidth: 0 }}>
        <h3 className="truncate">{stripDemo(card.title)}</h3>
        <p className="truncate">{card.idea_text || card.objective || 'No notes yet.'}</p>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <StageBadge stage={card.stage} />
        {demo && <ProvenanceBadge source="demo" />}
      </div>
      <small>{relativeTime(card.updated_at)}</small>
    </Link>
  )
}
