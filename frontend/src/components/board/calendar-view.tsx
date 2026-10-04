'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePatchContent } from '@/lib/api/hooks'
import { useRole } from '@/lib/use-role'
import { stripDemo } from '@/lib/format'
import type { Card } from '@/lib/api/types'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Month planner: drag a project onto a day to plan it, drag it back to "Not planned" to clear. Planning posts nothing. */
export function CalendarView({ cards }: { cards: Card[] }) {
  const patch = usePatchContent()
  const { canEdit } = useRole()
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [drag, setDrag] = useState<string | null>(null)
  const today = iso(new Date())

  const byDay = useMemo(() => {
    const m = new Map<string, Card[]>()
    for (const c of cards) if (c.scheduled_for) m.set(c.scheduled_for, [...(m.get(c.scheduled_for) ?? []), c])
    return m
  }, [cards])
  const unplanned = cards.filter((c) => !c.scheduled_for && c.stage !== 'published')

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const lead = (first.getDay() + 6) % 7
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const total = Math.ceil((lead + count) / 7) * 7
    return Array.from({ length: total }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - lead + i))
  }, [month])

  const drop = (day: string | null) => {
    if (drag && canEdit) patch.mutate({ id: drag, patch: { scheduled_for: day } })
    setDrag(null)
  }
  const chip = (c: Card) => (
    <Link key={c.id} href={`/projects/${c.id}/plan`} className="cal-chip" data-stage={c.stage} draggable={canEdit} onDragStart={() => setDrag(c.id)} onDragEnd={() => setDrag(null)} title={stripDemo(c.title)} data-testid="cal-chip">
      {stripDemo(c.title)}
    </Link>
  )

  return (
    <div className="cal" data-testid="calendar-view">
      <div className="cal-head">
        <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft size={14} />
        </Button>
        <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <Button size="sm" variant="secondary" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight size={14} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Today
        </Button>
      </div>
      <div className="cal-layout">
        <div className="cal-grid" role="grid" aria-label="Planned content">
          {WEEK.map((w) => (
            <div key={w} className="cal-dow" role="columnheader">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const key = iso(d)
            const list = byDay.get(key) ?? []
            return (
              <div
                key={key}
                role="gridcell"
                className="cal-day"
                data-out={d.getMonth() !== month.getMonth()}
                data-today={key === today}
                data-over={drag ? true : undefined}
                data-testid={`cal-day-${key}`}
                onDragOver={(e) => canEdit && drag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  drop(key)
                }}
              >
                <span className="cal-num">{d.getDate()}</span>
                {list.map(chip)}
              </div>
            )
          })}
        </div>
        <aside className="cal-pool" onDragOver={(e) => canEdit && drag && e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(null) }} aria-label="Not planned">
          <h3>Not planned</h3>
          {unplanned.length === 0 ? <p className="muted small">Everything has a day.</p> : unplanned.map(chip)}
          {canEdit && <small className="muted">Drag a project onto a day.</small>}
        </aside>
      </div>
    </div>
  )
}
