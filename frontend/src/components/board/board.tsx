'use client'

import { useCallback, useRef, useState, type DragEvent } from 'react'
import { Plus } from 'lucide-react'
import { ContentCard } from './content-card'
import { DeleteContentDialog } from './delete-content-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useMoveContent } from '@/lib/api/hooks'
import type { Board as BoardData, Card, Stage } from '@/lib/api/types'
import { STAGES } from '@/lib/format'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/utils'

type DropTarget = { stage: Stage; index: number } | null
const target0 = (d: DropTarget, stage: Stage) => d?.stage === stage

export function BoardSkeleton() {
  return (
    <div className="calendar-grid" aria-busy aria-label="Loading board">
      {STAGES.map((s) => (
        <div key={s.id} className="kanban" data-stage={s.id}>
          <div className="kanban-title">
            <span className="kanban-dot" />
            {s.label}
          </div>
          <div className="kanban-cards">
            {[0, 1].slice(0, s.id === 'idea' ? 2 : 1).map((i) => (
              <Skeleton key={i} style={{ height: 104, borderRadius: 12 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Six-column kanban with native drag & drop (+ keyboard/menu moves). Persists via POST /content/{id}/move. */
export function Board({ board }: { board: BoardData }) {
  const move = useMoveContent()
  const openNew = useUi((s) => s.openNewContent)
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget>(null)
  const [toDelete, setToDelete] = useState<Card | null>(null)
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const onDragStart = useCallback((e: DragEvent, card: Card) => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
    // Defer: changing the DOM inside dragstart can cancel the native drag in Chromium.
    setTimeout(() => setDragId(card.id), 0)
  }, [])
  const onDragEnd = useCallback(() => {
    setDragId(null)
    setDrop(null)
  }, [])
  const doMove = useCallback((card: Card, stage: Stage, position?: number) => move.mutate({ id: card.id, stage, position }), [move])
  const onMenuMove = useCallback((card: Card, stage: Stage) => doMove(card, stage), [doMove])

  const indexFromPointer = (stage: Stage, clientY: number) => {
    const el = colRefs.current[stage]
    if (!el) return 0
    const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-card-id]')).filter((c) => c.dataset.cardId !== dragId)
    let idx = 0
    for (const c of cards) {
      const r = c.getBoundingClientRect()
      if (clientY > r.top + r.height / 2) idx++
    }
    return idx
  }

  return (
    <>
      <div className="calendar-grid" data-testid="board">
        {board.columns.map((col) => {
          const stageMeta = STAGES.find((s) => s.id === col.stage)!
          const others = col.cards.filter((c) => c.id !== dragId)
          const beforeId = target0(drop, col.stage) ? others[drop!.index]?.id : undefined
          const target = drop?.stage === col.stage
          return (
            <section
              key={col.stage}
              className={cn('kanban', target && 'kanban-drop-target')}
              data-stage={col.stage}
              data-testid={`column-${col.stage}`}
              aria-label={`${stageMeta.label} column, ${col.count} item${col.count === 1 ? '' : 's'}`}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const index = indexFromPointer(col.stage, e.clientY)
                setDrop((d) => (d && d.stage === col.stage && d.index === index ? d : { stage: col.stage, index }))
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop((d) => (d?.stage === col.stage ? null : d))
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain') || dragId
                const card = col.cards.find((c) => c.id === id) ?? board.columns.flatMap((c) => c.cards).find((c) => c.id === id)
                const index = drop?.stage === col.stage ? drop.index : indexFromPointer(col.stage, e.clientY)
                setDragId(null)
                setDrop(null)
                if (!card) return
                const from = board.columns.find((c) => c.stage === card.stage)!
                const fromIdx = from.cards.findIndex((c) => c.id === card.id)
                if (card.stage === col.stage && fromIdx === index) return // dropped back in place
                doMove(card, col.stage, index)
              }}
            >
              <header className="kanban-title">
                <span className="kanban-dot" aria-hidden />
                <h2 style={{ fontSize: 'inherit', fontWeight: 'inherit', fontFamily: 'inherit' }}>{stageMeta.label}</h2>
                <small>{col.count}</small>
                <button className="kanban-add" aria-label={`Add content to ${stageMeta.label}`} onClick={() => openNew({ stage: col.stage })}>
                  <Plus size={15} />
                </button>
              </header>
              <div className="kanban-cards" ref={(el) => void (colRefs.current[col.stage] = el)}>
                {col.cards.length === 0 && (
                  <div className="kanban-empty">{target ? 'Drop here' : col.stage === 'idea' ? 'Add an idea to get started' : 'Drag cards here'}</div>
                )}
                {col.cards.map((card) => (
                  <ContentCard
                    key={card.id}
                    card={card}
                    dragging={card.id === dragId}
                    dropBefore={card.id === beforeId}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onMove={onMenuMove}
                    onDelete={setToDelete}
                  />
                ))}
                {target && others.length > 0 && drop && drop.index >= others.length && <div style={{ height: 3, borderRadius: 3, background: 'var(--primary)' }} />}
              </div>
            </section>
          )
        })}
      </div>
      <DeleteContentDialog card={toDelete} onClose={() => setToDelete(null)} />
    </>
  )
}
