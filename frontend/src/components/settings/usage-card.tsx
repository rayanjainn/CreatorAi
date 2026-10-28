'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Segmented } from '@/components/common/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { getJson } from '@/lib/api/client'
import { errorMessage } from '@/lib/api/errors'

type Bucket = { calls: number; ok: number; errors: number; invalid: number; cache_hits: number; tokens_in: number; tokens_out: number; avg_latency_ms: number | null }
type Usage = {
  days: number
  total: Bucket
  by_provider: (Bucket & { name: string })[]
  by_task: (Bucket & { task: string })[]
  by_day: { date: string; calls: number }[]
  note: string
}

const n = (v: number) => v.toLocaleString()

/** What the AI providers were asked to do, counted from the gateway's own log (`llm_usage`). */
export function UsageCard() {
  const [days, setDays] = useState('30')
  const q = useQuery({ queryKey: ['llm', 'usage', days], queryFn: () => getJson<Usage>(`/api/v1/llm/usage?days=${days}`) })
  const u = q.data
  const top = Math.max(1, ...(u?.by_day.map((d) => d.calls) ?? [1]))

  return (
    <section className="card" aria-labelledby="usage-h" data-testid="usage-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow">AI</div>
          <h2 id="usage-h">Usage</h2>
        </div>
        <Segmented
          label="Range"
          value={days}
          onChange={setDays}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
        />
      </div>
      {!u ? (
        q.isError ? <p className="field-error">{errorMessage(q.error)}</p> : <Skeleton style={{ height: 120, marginTop: 12 }} />
      ) : u.total.calls === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          No AI calls in this period.
        </p>
      ) : (
        <>
          <dl className="usage-totals">
            <div>
              <dt>Calls</dt>
              <dd>{n(u.total.calls)}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{n(u.total.errors + u.total.invalid)}</dd>
            </div>
            <div>
              <dt>From cache</dt>
              <dd>{n(u.total.cache_hits)}</dd>
            </div>
            <div>
              <dt>Tokens in / out</dt>
              <dd>
                {n(u.total.tokens_in)} / {n(u.total.tokens_out)}
              </dd>
            </div>
          </dl>
          <div className="usage-days" role="img" aria-label={`AI calls per day over the last ${u.by_day.length} days`}>
            {u.by_day.map((d) => (
              <i key={d.date} title={`${d.date}: ${d.calls} calls`} style={{ height: `${Math.max(4, (d.calls / top) * 100)}%`, opacity: d.calls ? 1 : 0.25 }} />
            ))}
          </div>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Provider and model</th>
                <th>Calls</th>
                <th>Failed</th>
                <th>Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {u.by_provider.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{n(p.calls)}</td>
                  <td>{n(p.errors + p.invalid)}</td>
                  <td>{p.avg_latency_ms == null ? '–' : `${(p.avg_latency_ms / 1000).toFixed(1)} s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary className="small">By task</summary>
            <table className="usage-table">
              <tbody>
                {u.by_task.map((t) => (
                  <tr key={t.task}>
                    <td>{t.task}</td>
                    <td>{n(t.calls)}</td>
                    <td>{n(t.tokens_in + t.tokens_out)} tokens</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="muted small">{u.note}</p>
        </>
      )}
    </section>
  )
}
