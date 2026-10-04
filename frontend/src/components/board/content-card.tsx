'use client'

import { useRole } from '@/lib/use-role'
import Link from 'next/link'
import { memo, type DragEvent, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'
import { Menu, MenuItem, MenuPopup } from '@/components/ui/menu'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { ProgressRing } from '@/components/common/progress-ring'
import { Thumb } from '@/components/common/thumb'
import type { Card, Stage } from '@/lib/api/types'
import { STAGES, STAGE_LABEL, isDemoTitle, stripDemo } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'

type Props = {
  card: Card
  dragging: boolean
  dropBefore: boolean
  onDragStart: (e: DragEvent, card: Card) => void
  onDragEnd: () => void
  onMove: (card: Card, stage: Stage) => void
  onDelete: (card: Card) => void
}

function ContentCardImpl({ card, dragging, dropBefore, onDragStart, onDragEnd, onMove, onDelete }: Props) {
  const { canEdit } = useRole()
  const demo = isDemoTitle(card.title)
  const idx = STAGES.findIndex((s) => s.id === card.stage)

  // Keyboard alternative to dragging: Alt + Left/Right moves the card between columns.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.altKey || !canEdit) return
    if (e.key === 'ArrowRight' && idx < STAGES.length - 1) {
      e.preventDefault()
      onMove(card, STAGES[idx + 1].id)
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault()
      onMove(card, STAGES[idx - 1].id)
    }
  }

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn('kanban-card', dragging && 'kanban-dragging', dropBefore && 'drop-before')}
      draggable={canEdit}
      onDragStart={(e) => onDragStart(e as unknown as DragEvent, card)}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      data-card-id={card.id}
      data-testid="content-card"
      aria-label={`${stripDemo(card.title)}, ${STAGE_LABEL[card.stage]}`}
    >
      {card.thumbnail_url && <Thumb src={card.thumbnail_url} className="card-thumb" iconSize={20} />}
      <div className="kanban-card-top">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          {demo ? <ProvenanceBadge source="demo" /> : <ProvenanceBadge source="user" iconOnly />}
          {card.running_jobs.active && (
            <span className="running-pill" title={card.running_jobs.types.join(', ')}>
              <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} aria-hidden /> working
            </span>
          )}
        </div>
        <Menu.Root>
          <Menu.Trigger className="card-menu-btn" aria-label={`Actions for ${stripDemo(card.title)}`}>
            <MoreHorizontal size={15} />
          </Menu.Trigger>
          <MenuPopup>
            <Menu.LinkItem className="menu-item" render={<Link href={`/projects/${card.id}`} />}>
              <ExternalLink /> Open project
            </Menu.LinkItem>
            <div className="menu-sep" />
            {STAGES.filter((s) => s.id !== card.stage).map((s) => (
              <MenuItem key={s.id} onClick={() => onMove(card, s.id)}>
                <ArrowRight /> Move to {s.label}
              </MenuItem>
            ))}
            <div className="menu-sep" />
            <MenuItem danger onClick={() => onDelete(card)}>
              <Trash2 /> Delete…
            </MenuItem>
          </MenuPopup>
        </Menu.Root>
      </div>
      <h3>
        <Link href={`/projects/${card.id}`} title={card.title}>
          {stripDemo(card.title)}
        </Link>
      </h3>
      {card.idea_text && <p>{card.idea_text}</p>}
      <div className="kanban-card-meta">
        <ProgressRing percent={card.progress.percent} />
        <span className="grow">
          {card.progress.assets_total > 0 ? `${card.progress.assets_ready}/${card.progress.assets_total} clips ready` : relativeTime(card.updated_at)}
        </span>
      </div>
    </motion.article>
  )
}

export const ContentCard = memo(ContentCardImpl)
