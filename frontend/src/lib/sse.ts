import { withAccessToken } from '@/lib/api/client'

export type JobEvent = {
  id?: string
  job_id?: string
  type?: string
  message?: string | null
  status: string
  progress: number
  stage?: string
  error?: string | null
  result?: Record<string, unknown>
  [k: string]: unknown
}

export type JobSubscription = { close: () => void }

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'cancelled'])
export const isTerminal = (status: string) => TERMINAL.has(status)

/**
 * Follow a job through `GET /jobs/{id}/events` (SSE). EventSource can not set headers, so the token
 * travels as `?access_token=`. EventSource reconnects by itself on transient drops; if the stream
 * is closed for good (server restart, auth) we retry with backoff a few times, then give up and let
 * the jobs store's polling fallback report the final state.
 */
export function subscribeJob(
  jobId: string,
  handlers: { onEvent: (e: JobEvent) => void; onDone?: (e: JobEvent) => void; onGiveUp?: () => void },
): JobSubscription {
  let es: EventSource | null = null
  let closed = false
  let tries = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const open = () => {
    if (closed) return
    es = new EventSource(withAccessToken(`/api/v1/jobs/${encodeURIComponent(jobId)}/events`))
    es.addEventListener('progress', (m) => {
      tries = 0
      try {
        handlers.onEvent(JSON.parse((m as MessageEvent).data) as JobEvent)
      } catch {
        /* ignore malformed frame */
      }
    })
    es.addEventListener('done', (m) => {
      try {
        const ev = JSON.parse((m as MessageEvent).data) as JobEvent
        handlers.onEvent(ev)
        handlers.onDone?.(ev)
      } catch {
        /* ignore */
      }
      close()
    })
    es.onerror = () => {
      if (closed) return
      // readyState CLOSED = the browser gave up; CONNECTING = it is retrying by itself.
      if (es && es.readyState === EventSource.CLOSED) {
        es.close()
        es = null
        if (++tries > 4) {
          close()
          handlers.onGiveUp?.()
          return
        }
        timer = setTimeout(open, Math.min(1000 * 2 ** tries, 10000))
      }
    }
  }

  const close = () => {
    closed = true
    if (timer) clearTimeout(timer)
    es?.close()
    es = null
  }

  open()
  return { close }
}
