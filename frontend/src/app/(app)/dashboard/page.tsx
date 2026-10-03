'use client'

import Link from 'next/link'
import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CalendarRange, FolderOpen, KanbanSquare, Lightbulb, Rocket, Send, Settings2, Sparkles } from 'lucide-react'
import { ProjectCard } from '@/components/board/project-card'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/components/auth-provider'
import { useActivity, useBoard, useCreateContent } from '@/lib/api/hooks'
import { flattenBoard } from '@/lib/board'
import { actionLabel } from '@/lib/format'
import { greeting, relativeTime } from '@/lib/time'
import { useActiveJobs, useJobs } from '@/stores/jobs'
import { useUi } from '@/stores/ui'

function splitPrompt(text: string): { title: string; notes?: string } {
  const t = text.trim()
  const firstLine = t.split('\n')[0].trim()
  if (firstLine.length <= 120 && firstLine.length === t.length) return { title: firstLine }
  const title = firstLine.length <= 120 ? firstLine : firstLine.slice(0, 117).trimEnd() + '…'
  return { title, notes: t }
}

function PromptBox() {
  const router = useRouter()
  const create = useCreateContent()
  const [text, setText] = useState('')
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) return
    const { title, notes } = splitPrompt(text)
    create.mutate(
      { title, idea_text: notes },
      {
        onSuccess: (card) => {
          setText('')
          router.push(`/projects/${card.id}`)
        },
      },
    )
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) submit()
  }
  return (
    <form className="prompt-box" onSubmit={submit} data-testid="prompt-box">
      <label htmlFor="prompt" className="sr-only">
        What do you want to make?
      </label>
      <textarea id="prompt" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="What do you want to make? e.g. A 45-second Short on why most creators burn out editing" rows={2} maxLength={2000} data-testid="prompt-input" />
      <div className="prompt-foot">
        <small>
          <Sparkles size={12} aria-hidden /> Creates a content item in your Idea column. Enter to start, Shift + Enter for a new line.
        </small>
        <Button type="submit" loading={create.isPending} disabled={!text.trim()} data-testid="prompt-submit">
          Start project <Send size={14} />
        </Button>
      </div>
    </form>
  )
}

function Stat({ icon, label, value, tone, href }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string; href: string }) {
  return (
    <Link href={href} className="stat">
      <div className={`stat-icon ${tone ?? ''}`}>{icon}</div>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </Link>
  )
}

const QUICK = [
  { href: '/calendar', Icon: KanbanSquare, title: 'Open the content board', text: 'See every idea by stage and drag it forward.' },
  { href: '/assets', Icon: FolderOpen, title: 'Add footage', text: 'Upload clips and let the pipeline transcribe and index them.' },
  { href: '/creative-director', Icon: Rocket, title: 'Plan a video', text: 'Turn an idea into a structure, hooks and a shot list.' },
  { href: '/settings', Icon: Settings2, title: 'Check AI setup', text: 'Verify your keys and see which providers are live.' },
]

export default function DashboardPage() {
  const { profile } = useAuth()
  const board = useBoard()
  const activity = useActivity({ limit: 6 })
  const openNew = useUi((s) => s.openNewContent)
  const active = useActiveJobs()

  const cards = useMemo(() => flattenBoard(board.data).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [board.data])
  const counts = useMemo(() => {
    const by = Object.fromEntries((board.data?.columns ?? []).map((c) => [c.stage, c.count])) as Record<string, number>
    const inProd = (by.script ?? 0) + (by.shoot ?? 0) + (by.edit ?? 0) + (by.review ?? 0)
    return { total: board.data?.total ?? 0, inProd, published: by.published ?? 0 }
  }, [board.data])

  const name = profile?.display_name?.split(' ')[0] ?? ''

  return (
    <div className="page">
      <section className="hero" aria-labelledby="hero-h">
        <div className="glow violet" />
        <div className="glow amber" />
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="status-dot" /> {greeting()}
            {name ? `, ${name}` : ''}
          </div>
          <h1 id="hero-h">
            What do you want <span>to make?</span>
          </h1>
          <p>Describe the video in a sentence. It becomes a content item you can plan, script, shoot and edit from one place.</p>
          <PromptBox />
        </div>
        <div className="hero-stats" aria-label="Your workspace at a glance">
          <Stat href="/calendar" icon={<KanbanSquare size={17} />} label="On your board" value={board.isPending ? <Skeleton style={{ height: 16, width: 36 }} /> : counts.total} />
          <Stat href="/calendar" icon={<CalendarRange size={17} />} label="In production" tone="cyan" value={board.isPending ? <Skeleton style={{ height: 16, width: 36 }} /> : counts.inProd} />
          <Stat href="/calendar" icon={<Rocket size={17} />} label="Published" tone="amber" value={board.isPending ? <Skeleton style={{ height: 16, width: 36 }} /> : counts.published} />
        </div>
      </section>

      <section aria-label="Quick start">
        <div className="quick-grid">
          {QUICK.map(({ href, Icon, title, text }) => (
            <Link key={href} href={href} className="quick-card">
              <div className="stat-icon">
                <Icon size={17} />
              </div>
              <b>{title}</b>
              <p>{text}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="dash-grid">
        <section aria-labelledby="recent-h">
          <div className="section-head" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow violet-text">Pick up where you left off</div>
              <h2 id="recent-h">Recent projects</h2>
            </div>
            <Link href="/projects" className="button button-secondary button-sm">
              View all <ArrowRight size={13} />
            </Link>
          </div>
          {board.isPending ? (
            <div className="grid-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} style={{ height: 250, borderRadius: 15 }} />
              ))}
            </div>
          ) : board.isError ? (
            <ErrorState error={board.error} onRetry={() => board.refetch()} title="Could not load your projects" />
          ) : cards.length === 0 ? (
            <EmptyState
              icon={<Lightbulb size={22} />}
              title="Nothing here yet"
              description="Type an idea in the box above to create your first content item. To explore with sample data, run `make seed` (demo items are labelled [DEMO])."
              actions={<Button onClick={() => openNew()}>New content</Button>}
            />
          ) : (
            <div className="grid-2">
              {cards.slice(0, 6).map((c, i) => (
                <ProjectCard key={c.id} card={c} index={i} />
              ))}
            </div>
          )}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="card" aria-labelledby="jobs-h" data-testid="running-jobs">
            <div className="card-heading">
              <div>
                <div className="eyebrow">Background work</div>
                <h2 id="jobs-h">Running jobs</h2>
              </div>
              <Link href="/jobs" className="button button-ghost button-sm">
                All jobs
              </Link>
            </div>
            <div style={{ marginTop: 10 }}>
              {active.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, padding: '10px 0' }}>
                  Nothing is running. Uploads, matching, clip generation and renders show up here with live progress.
                </p>
              ) : (
                active.map((j) => (
                  <div key={j.id} className="mini-row">
                    <span className="spinner" style={{ color: 'var(--primary-hover)' }} aria-hidden />
                    <div>
                      <b>{j.label}</b>
                      <small>
                        {j.status === 'queued' ? 'Queued' : j.stage || 'Working'} · {j.progress}%
                      </small>
                      <div className="progress" style={{ marginTop: 6 }}>
                        <i style={{ width: `${j.progress}%` }} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="act-h">
            <div className="card-heading">
              <div>
                <div className="eyebrow">Latest changes</div>
                <h2 id="act-h">Activity</h2>
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              {activity.isPending ? (
                [0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 40, margin: '10px 0' }} />)
              ) : activity.isError ? (
                <p className="field-error" style={{ padding: '10px 0' }}>Could not load activity.</p>
              ) : activity.data.items.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, padding: '10px 0' }}>No activity yet.</p>
              ) : (
                activity.data.items.map((a) => (
                  <div key={a.id} className="mini-row">
                    <div className="activity-dot">
                      <Sparkles size={14} />
                    </div>
                    <div>
                      <b>{actionLabel(a.action)}</b>
                      <small className="truncate">{(a.meta?.title as string | undefined) ?? a.entity_type}</small>
                    </div>
                    <small>{relativeTime(a.created_at)}</small>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
