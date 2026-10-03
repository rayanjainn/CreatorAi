'use client'

import { useState } from 'react'
import { Lightbulb, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Board, BoardSkeleton } from '@/components/board/board'
import { IdeasPanel } from '@/components/board/ideas-panel'
import { ErrorState } from '@/components/common/error-state'
import { EmptyState } from '@/components/common/empty-state'
import { DOMAINS } from '@/components/board/new-content-dialog'
import { useBoard } from '@/lib/api/hooks'
import { useDebounced } from '@/lib/use-debounced'
import { useMediaQuery } from '@/lib/use-media'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/utils'

export default function ContentBoardPage() {
  const openNew = useUi((s) => s.openNewContent)
  const [q, setQ] = useState('')
  const [domain, setDomain] = useState('')
  const wide = useMediaQuery('(min-width: 1760px)', true)
  // null = follow the screen size (side column on very wide screens, hidden otherwise) until toggled.
  const [ideasPref, setIdeasOpen] = useState<boolean | null>(null)
  const ideasOpen = ideasPref ?? wide
  const dq = useDebounced(q, 250)
  const board = useBoard({ q: dq, domain })

  return (
    <div className="page">
      <PageHeader
        eyebrow="CreatorAI / Studio"
        title="Content Board"
        description="Move every idea from first spark to published. Drag cards between columns, or use the card menu (Alt + arrow keys also work)."
        actions={
          <>
            <Button variant="secondary" onClick={() => setIdeasOpen(!ideasOpen)} aria-pressed={ideasOpen}>
              <Lightbulb size={15} /> Ideas
            </Button>
            <Button onClick={() => openNew()} data-testid="board-new">
              <Plus size={15} /> New content
            </Button>
          </>
        }
      />
      <div className="toolbar">
        <label className="search-inline">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="Search titles and notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the board" />
        </label>
        <div className="toolbar-group">
          <Select aria-label="Filter by topic area" value={domain} onChange={(e) => setDomain(e.target.value)} style={{ minHeight: 38, width: 190 }}>
            <option value="">All topic areas</option>
            {DOMAINS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
          {board.data && (
            <small>
              {board.data.total} item{board.data.total === 1 ? '' : 's'}
            </small>
          )}
        </div>
      </div>

      <div className={cn('board-wrap', ideasOpen && 'with-ideas')}>
        <div style={{ minWidth: 0 }}>
          {board.isPending ? (
            <BoardSkeleton />
          ) : board.isError ? (
            <ErrorState error={board.error} onRetry={() => board.refetch()} title="Could not load the board" />
          ) : board.data.total === 0 && !dq && !domain ? (
            <EmptyState
              icon={<Lightbulb size={22} />}
              title="Your board is empty"
              description="Capture the first idea, or load the demo data with `make seed` to see the board filled with clearly labelled [DEMO] items."
              actions={
                <Button onClick={() => openNew()}>
                  <Plus size={15} /> New content
                </Button>
              }
            />
          ) : (
            <Board board={board.data} />
          )}
        </div>
        {ideasOpen && <IdeasPanel />}
      </div>
    </div>
  )
}
