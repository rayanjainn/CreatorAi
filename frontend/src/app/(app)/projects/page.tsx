'use client'

import { useMemo, useState } from 'react'
import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { ProjectCard, ProjectRow } from '@/components/board/project-card'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useBoard } from '@/lib/api/hooks'
import { flattenBoard } from '@/lib/board'
import { useDebounced } from '@/lib/use-debounced'
import { STAGES } from '@/lib/format'
import type { Stage } from '@/lib/api/types'
import { useUi } from '@/stores/ui'

export default function ProjectsPage() {
  const openNew = useUi((s) => s.openNewContent)
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<Stage | 'all'>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const dq = useDebounced(q, 250)
  const board = useBoard({ q: dq })

  const all = useMemo(() => flattenBoard(board.data).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [board.data])
  const shown = stage === 'all' ? all : all.filter((c) => c.stage === stage)
  const counts = useMemo(() => Object.fromEntries((board.data?.columns ?? []).map((c) => [c.stage, c.count])) as Record<string, number>, [board.data])

  return (
    <div className="page">
      <PageHeader
        eyebrow="CreatorAI / Studio"
        title="Projects"
        description="Every content item in one place. Open one to plan, script, match footage and cut clips."
        actions={
          <Button onClick={() => openNew()}>
            <Plus size={15} /> New content
          </Button>
        }
      />
      <div className="toolbar">
        <label className="search-inline">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        </label>
        <div className="toolbar-group">
          <div className="segmented" role="group" aria-label="Filter by stage">
            <button aria-pressed={stage === 'all'} className={stage === 'all' ? 'selected' : ''} onClick={() => setStage('all')}>
              All{board.data ? ` (${board.data.total})` : ''}
            </button>
            {STAGES.map((s) => (
              <button key={s.id} aria-pressed={stage === s.id} className={stage === s.id ? 'selected' : ''} onClick={() => setStage(s.id)}>
                {s.label}
                {board.data ? ` (${counts[s.id] ?? 0})` : ''}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="View">
            <button aria-label="Grid view" aria-pressed={view === 'grid'} className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}>
              <LayoutGrid size={14} />
            </button>
            <button aria-label="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>
              <List size={14} />
            </button>
          </div>
        </div>
      </div>

      {board.isPending ? (
        <div className="project-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} style={{ height: 270, borderRadius: 15 }} />
          ))}
        </div>
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} title="Could not load projects" />
      ) : shown.length === 0 ? (
        dq || stage !== 'all' ? (
          <EmptyState
            icon={<Search size={22} />}
            title="No projects match"
            description="Try a different search or stage filter."
            actions={
              <Button
                variant="secondary"
                onClick={() => {
                  setQ('')
                  setStage('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No projects yet"
            description="Create a content item and it shows up here."
            actions={<Button onClick={() => openNew()}>New content</Button>}
          />
        )
      ) : view === 'grid' ? (
        <div className="project-grid" data-testid="project-grid">
          {shown.map((c, i) => (
            <ProjectCard key={c.id} card={c} index={i} />
          ))}
        </div>
      ) : (
        <div className="project-list">
          {shown.map((c) => (
            <ProjectRow key={c.id} card={c} />
          ))}
        </div>
      )}
    </div>
  )
}
