'use client'

import Link from 'next/link'
import { StageBadge } from '@/components/common/stage-badge'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Thumb } from '@/components/common/thumb'
import { isDemoTitle, stripDemo } from '@/lib/format'
import type { Card } from '@/lib/api/types'

/** Shared row shell of the hubs: thumb, title, stage, a body slot and deep links. */
export function HubRow({ card, children, links, testId }: { card: Card; children: React.ReactNode; links: { href: string; label: string }[]; testId: string }) {
  return (
    <li className="hub-row" data-testid={testId}>
      <Thumb src={card.thumbnail_url} iconSize={18} className="thumb hub-thumb" />
      <div className="hub-main">
        <div className="hub-title">
          <Link href={`/projects/${card.id}/plan`} className="truncate">
            {stripDemo(card.title)}
          </Link>
          <StageBadge stage={card.stage} />
          {isDemoTitle(card.title) && <ProvenanceBadge source="demo" />}
        </div>
        {children}
      </div>
      <div className="hub-links">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="button button-secondary button-sm">
            {l.label}
          </Link>
        ))}
      </div>
    </li>
  )
}

export function HubSkeleton() {
  return (
    <ul className="hub-list">
      {[0, 1, 2].map((i) => (
        <li key={i} className="hub-row skeleton" style={{ height: 96 }} />
      ))}
    </ul>
  )
}
