'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, BarChart3, Clapperboard, Eye, Film, Lightbulb, MessageCircle, RefreshCw, ThumbsUp, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSyncYoutube } from '@/lib/api/publishing'
import { relativeTime } from '@/lib/time'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState } from '@/components/common/error-state'
import { EmptyState } from '@/components/common/empty-state'
import { Segmented } from '@/components/common/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { useInsights } from '@/lib/api/hooks'
import { STAGES } from '@/lib/format'
import type { InsightsReport } from '@/lib/api/types'

const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`)

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="ins-stat">
      <span className="ins-stat-icon" aria-hidden>
        {icon}
      </span>
      <small>{label}</small>
      <b>{value}</b>
      {hint && <em>{hint}</em>}
    </div>
  )
}

/** Bars drawn with CSS only: each bar is a labelled, titled element so it reads without colour or hover. */
function Bars({ rows, max, tone = 'violet' }: { rows: { label: string; value: number; sub?: string }[]; max?: number; tone?: 'violet' | 'green' | 'amber' }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="ins-bars" data-tone={tone}>
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value}`}>
          <span className="ins-bar-label">{r.label}</span>
          <span className="ins-bar-track">
            <i style={{ width: `${(r.value / top) * 100}%` }} />
          </span>
          <b>{r.value}</b>
        </li>
      ))}
    </ul>
  )
}

function Weekly({ weeks }: { weeks: InsightsReport['pipeline']['weekly'] }) {
  const top = Math.max(1, ...weeks.flatMap((w) => [w.created, w.published]))
  return (
    <div className="ins-weekly" role="img" aria-label="Ideas created and videos published per week">
      {weeks.map((w) => (
        <div key={w.week} title={`Week of ${w.week}: ${w.created} created, ${w.published} published`}>
          <span className="ins-col">
            <i className="c" style={{ height: `${(w.created / top) * 100}%` }} />
            <i className="p" style={{ height: `${(w.published / top) * 100}%` }} />
          </span>
          <small>{w.week.slice(5)}</small>
        </div>
      ))}
    </div>
  )
}

function Heat({ days }: { days: InsightsReport['activity'] }) {
  const top = Math.max(1, ...days.map((d) => d.count))
  return (
    <div className="ins-heat" role="img" aria-label="Activity over the last 30 days">
      {days.map((d) => (
        <i key={d.date} title={`${d.date}: ${d.count} changes`} style={{ ['--lvl' as string]: d.count === 0 ? 0 : Math.ceil((d.count / top) * 4) }} />
      ))}
    </div>
  )
}

function Performance({ perf }: { perf: InsightsReport['performance'] }) {
  const sync = useSyncYoutube()
  return (
    <section className="card ins-perf" data-testid="performance-note">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">YouTube</div>
          <h2>Performance on the platform</h2>
        </div>
        {perf.connected && (
          <Button size="sm" variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending}>
            <RefreshCw size={13} /> Sync now
          </Button>
        )}
      </div>
      {perf.reason && <p className="muted">{perf.reason}</p>}
      {!perf.connected && (
        <Link href="/settings#youtube" className="link small">
          Connect a channel
        </Link>
      )}
      {perf.available && perf.totals && perf.videos && (
        <>
          <div className="ins-grid" style={{ marginTop: 12 }}>
            <Stat icon={<Eye size={16} />} label="Views" value={perf.totals.views.toLocaleString()} hint={`${perf.totals.videos} published from CreatorAi`} />
            <Stat icon={<ThumbsUp size={16} />} label="Likes" value={perf.totals.likes.toLocaleString()} />
            <Stat icon={<MessageCircle size={16} />} label="Comments" value={perf.totals.comments.toLocaleString()} hint={perf.last_sync_at ? `synced ${relativeTime(perf.last_sync_at)}` : undefined} />
          </div>
          <Bars rows={perf.videos.filter((v) => v.views != null).slice(0, 8).map((v) => ({ label: v.title, value: v.views ?? 0 }))} tone="green" />
        </>
      )}
    </section>
  )
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(90)
  const q = useInsights(days)
  const r = q.data

  return (
    <div className="page" data-testid="insights-page">
      <PageHeader
        eyebrow="CreatorAI / Grow"
        title="Creator intelligence"
        description="How your content is being made: where ideas stall, what the clip finder keeps, how much footage you work with. Every number is counted from your own workspace."
        actions={
          <Segmented
            label="Range"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '180', label: '6 months' },
            ]}
          />
        }
      />

      {q.isPending && (
        <div className="ins-grid">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 110 }} />
          ))}
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load insights" />}

      {r && r.pipeline.total === 0 && r.footage.assets === 0 && (
        <EmptyState
          title="Nothing to analyse yet"
          description="Insights appear as you work: add an idea to your board, upload footage, accept a clip. Until then there is nothing real to count."
          actions={
            <Link href="/dashboard" className="button button-sm">
              Start a project <ArrowRight size={13} />
            </Link>
          }
        />
      )}

      {r && (r.pipeline.total > 0 || r.footage.assets > 0) && (
        <>
          {r.nudges.length > 0 && (
            <section className="card ins-nudges" aria-labelledby="nudge-h" data-testid="insight-nudges">
              <div className="card-heading">
                <div>
                  <div className="eyebrow violet-text">Worth doing next</div>
                  <h2 id="nudge-h">Suggestions from your numbers</h2>
                </div>
              </div>
              <ul>
                {r.nudges.map((n) => (
                  <li key={n.kind}>
                    <Lightbulb size={15} aria-hidden />
                    <span>{n.text}</span>
                    <Link href={n.href} className="link">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="ins-grid">
            <Stat icon={<BarChart3 size={16} />} label="Projects" value={r.pipeline.total} hint={`${r.pipeline.by_stage.published ?? 0} published`} />
            <Stat icon={<Timer size={16} />} label="Idea to published" value={r.pipeline.avg_days_to_publish == null ? '–' : `${r.pipeline.avg_days_to_publish} days`} hint={r.pipeline.avg_days_to_publish == null ? 'Shows once a video is published' : 'average'} />
            <Stat icon={<Film size={16} />} label="Footage" value={`${r.footage.hours} h`} hint={`${r.footage.assets} files, ${r.footage.gigabytes} GB`} />
            <Stat icon={<Clapperboard size={16} />} label="Clips you accept" value={pct(r.clips.accept_rate)} hint={r.clips.accept_rate == null ? `${r.clips.total} suggested; needs 3 decisions` : `${r.clips.total} suggested in total`} />
          </div>

          <div className="ins-two">
            <section className="card" aria-labelledby="pipe-h">
              <div className="card-heading">
                <div>
                  <div className="eyebrow violet-text">Content workflow</div>
                  <h2 id="pipe-h">Where your projects are</h2>
                </div>
              </div>
              <Bars rows={STAGES.map((s) => ({ label: s.label, value: r.pipeline.by_stage[s.id] ?? 0 }))} />
              {r.pipeline.stale.length > 0 && (
                <div className="ins-stale">
                  <h3>Stalled for {r.pipeline.stale_days}+ days</h3>
                  <ul>
                    {r.pipeline.stale.map((s) => (
                      <li key={s.id}>
                        <Link href={`/projects/${s.id}/plan`}>{s.title}</Link>
                        <small>
                          {s.stage} · {s.days} days
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="card" aria-labelledby="week-h">
              <div className="card-heading">
                <div>
                  <div className="eyebrow violet-text">Rhythm</div>
                  <h2 id="week-h">Created vs published, per week</h2>
                </div>
                <span className="ins-legend">
                  <i className="c" /> created <i className="p" /> published
                </span>
              </div>
              <Weekly weeks={r.pipeline.weekly} />
              <h3 className="ins-sub">Last 30 days of activity</h3>
              <Heat days={r.activity} />
            </section>
          </div>

          <div className="ins-two">
            <section className="card" aria-labelledby="clip-h">
              <div className="card-heading">
                <div>
                  <div className="eyebrow violet-text">Automated clips</div>
                  <h2 id="clip-h">How the clip finder is doing</h2>
                </div>
              </div>
              {r.clips.total === 0 ? (
                <p className="muted small">No clips yet. Upload long footage and run Smart Clips.</p>
              ) : (
                <>
                  <Bars
                    tone="green"
                    rows={Object.entries(r.clips.by_status).map(([k, v]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), value: v }))}
                  />
                  <h3 className="ins-sub">Score spread (how confident the finder was)</h3>
                  <Bars tone="amber" rows={r.clips.score_buckets.map((b) => ({ label: `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}`, value: b.count }))} />
                  <p className="muted small" style={{ marginTop: 10 }}>
                    Average clip {r.clips.avg_length_sec ?? '–'} s{r.clips.accepted_avg_length_sec ? `; the ones you accepted average ${r.clips.accepted_avg_length_sec} s.` : '.'}
                  </p>
                </>
              )}
            </section>

            <section className="card" aria-labelledby="out-h">
              <div className="card-heading">
                <div>
                  <div className="eyebrow violet-text">Output</div>
                  <h2 id="out-h">Scripts and exports</h2>
                </div>
              </div>
              <div className="ins-mini">
                <div>
                  <b>{r.scripts.count}</b>
                  <small>scripts{r.scripts.avg_length_sec ? `, about ${Math.round(r.scripts.avg_length_sec)} s each` : ''}</small>
                </div>
                <div>
                  <b>{r.renders.done}</b>
                  <small>exports done ({r.renders.minutes} min of video)</small>
                </div>
                <div>
                  <b>{r.renders.failed}</b>
                  <small>exports failed</small>
                </div>
              </div>
              {Object.keys(r.renders.by_preset).length > 0 && (
                <>
                  <h3 className="ins-sub">Exports by platform preset</h3>
                  <Bars rows={Object.entries(r.renders.by_preset).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v }))} />
                </>
              )}
              {Object.keys(r.scripts.by_platform).length > 0 && (
                <>
                  <h3 className="ins-sub">Scripts by platform</h3>
                  <Bars rows={Object.entries(r.scripts.by_platform).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v }))} />
                </>
              )}
            </section>
          </div>

          <Performance perf={r.performance} />
        </>
      )}
    </div>
  )
}
