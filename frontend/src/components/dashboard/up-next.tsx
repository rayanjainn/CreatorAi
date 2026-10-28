'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { CalendarClock, Handshake, Hourglass } from 'lucide-react'
import { useDealSummary } from '@/lib/api/monetization'
import { stripDemo } from '@/lib/format'
import type { Card } from '@/lib/api/types'

type Row = { key: string; href: string; icon: React.ReactNode; title: string; meta: string; late?: boolean; sort: number }

const DAY = 86_400_000
const today = () => new Date(new Date().toDateString()).getTime()
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).getTime()

function when(iso: string): { text: string; late: boolean; days: number } {
  const d = Math.round((day(iso) - today()) / DAY)
  if (d < 0) return { text: `${-d} ${d === -1 ? 'day' : 'days'} late`, late: true, days: d }
  if (d === 0) return { text: 'today', late: false, days: d }
  if (d === 1) return { text: 'tomorrow', late: false, days: d }
  return { text: `in ${d} days`, late: false, days: d }
}

/**
 * What needs you next, from your own data: videos scheduled in the coming week (or overdue), brand deliverables that
 * are due, and projects nobody has touched for two weeks.
 */
export function UpNext({ cards }: { cards: Card[] }) {
  const deals = useDealSummary()
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const c of cards) {
      if (c.stage === 'published') continue
      if (c.scheduled_for) {
        const w = when(c.scheduled_for)
        if (w.days <= 7) out.push({ key: `s:${c.id}`, href: `/projects/${c.id}/plan`, icon: <CalendarClock size={15} />, title: stripDemo(c.title), meta: `Goes out ${w.text}`, late: w.late, sort: w.days })
        continue
      }
      const idle = Math.floor((today() - new Date(c.updated_at).getTime()) / DAY)
      if (idle >= 14) out.push({ key: `i:${c.id}`, href: `/projects/${c.id}/plan`, icon: <Hourglass size={15} />, title: stripDemo(c.title), meta: `Untouched for ${idle} days · ${c.stage}`, sort: 30 + Math.min(idle, 60) / 100 })
    }
    for (const d of [...(deals.data?.overdue ?? []), ...(deals.data?.upcoming ?? [])]) {
      if (!d.due_date || out.some((r) => r.key === `d:${d.id}`)) continue
      const w = when(d.due_date)
      if (w.days <= 14) out.push({ key: `d:${d.id}`, href: '/monetization', icon: <Handshake size={15} />, title: `${d.brand} deliverable`, meta: `Due ${w.text}`, late: w.late, sort: w.days })
    }
    return out.sort((a, b) => a.sort - b.sort).slice(0, 6)
  }, [cards, deals.data])

  return (
    <section className="card up-next" aria-labelledby="next-h" data-testid="up-next">
      <div className="card-heading">
        <div>
          <div className="eyebrow">This week</div>
          <h2 id="next-h">Up next</h2>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          Nothing is due. Give a project a date on the <Link href="/calendar" className="link">calendar</Link> and it shows up here.
        </p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} data-late={r.late || undefined}>
                <span className="up-icon">{r.icon}</span>
                <span className="up-text">
                  <b>{r.title}</b>
                  <small>{r.meta}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
