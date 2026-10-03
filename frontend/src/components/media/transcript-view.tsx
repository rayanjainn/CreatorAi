'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { formatTimecode } from '@/lib/format'
import { highlightParts } from '@/lib/library'
import type { TranscriptSegment } from '@/lib/api/types'

export type TranscriptSeg = Pick<TranscriptSegment, 'idx' | 'start' | 'end' | 'text'> & { words?: TranscriptSegment['words'] }

type Props = {
  segments: TranscriptSeg[]
  currentTime: number
  onSeek: (t: number) => void
  /** Highlight words of a search query. */
  query?: string
  /** Estimated word times (SRT/VTT): the words are approximate. */
  estimated?: boolean
}

/** Transcript with clickable words (seek) and the playing segment/word highlighted. */
export function TranscriptView({ segments, currentTime, onSeek, query, estimated }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const activeIdx = useMemo(() => {
    const i = segments.findIndex((s) => currentTime >= s.start && currentTime < s.end)
    return i >= 0 ? segments[i].idx : -1
  }, [segments, currentTime])

  // Keep the playing segment in view inside the transcript box only (never scroll the page).
  useEffect(() => {
    const c = box.current
    const node = c?.querySelector<HTMLElement>('[data-active="true"]')
    if (!c || !node) return
    const top = node.offsetTop - c.offsetTop
    if (top < c.scrollTop + 8 || top + node.offsetHeight > c.scrollTop + c.clientHeight - 8) {
      c.scrollTo({ top: Math.max(0, top - c.clientHeight / 3), behavior: 'smooth' })
    }
  }, [activeIdx])

  return (
    <div className="transcript" ref={box} data-testid="transcript" tabIndex={0} aria-label="Transcript. Click a word to jump to it.">
      {estimated && <p className="transcript-note">Word times are estimated from subtitle cues, so clicks land on the right sentence but may be off by a moment.</p>}
      {segments.map((s) => (
        <Segment key={s.idx} seg={s} active={s.idx === activeIdx} currentTime={s.idx === activeIdx ? currentTime : -1} onSeek={onSeek} query={query} />
      ))}
    </div>
  )
}

const Segment = memo(function Segment({ seg, active, currentTime, onSeek, query }: { seg: TranscriptSeg; active: boolean; currentTime: number; onSeek: (t: number) => void; query?: string }) {
  const hasWords = !!seg.words?.length
  return (
    <div className="t-seg" data-active={active} data-testid="transcript-segment">
      <button type="button" className="t-time mono" onClick={() => onSeek(seg.start)} aria-label={`Jump to ${formatTimecode(seg.start)}`}>
        {formatTimecode(seg.start)}
      </button>
      <p>
        {hasWords
          ? seg.words!.map((w, i) => {
              const live = currentTime >= w.start && currentTime < w.end
              const hit = !!query && highlightParts(w.word, query).some((p) => p.hit)
              return (
                <button
                  key={i}
                  type="button"
                  className="t-word"
                  data-live={live || undefined}
                  data-hit={hit || undefined}
                  data-start={w.start}
                  onClick={() => onSeek(w.start)}
                >
                  {w.word}
                </button>
              )
            })
          : (
            <button type="button" className="t-word t-plain" onClick={() => onSeek(seg.start)}>
              {highlightParts(seg.text, query ?? '').map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
            </button>
          )}
      </p>
    </div>
  )
})
