/**
 * Caption building (Plan 8.9), mirroring `rebuild_captions` in the backend: for each non-rejected video item take the
 * transcript words inside `[src_in, src_out]`, map them to timeline time, group them into lines (3 words for
 * bold_center/karaoke, 7 for minimal_bottom, at most 2 s per line), extend each line's end to the next line's start minus
 * 0.02 s or +0.3 s, and clamp to the item. Sponsor placeholders with `text` get lines estimated at 2.5 words/second.
 */
import { MIN_LAYER_SEC, active, durationOf, registerRebuildCaptions, type OpContext } from './ops'
import { cloneTimeline, newItemId, type CaptionItem, type CaptionStyle, type CaptionWord, type LayerStatus, type Timeline, type VideoItem } from './types'
import { pyRound } from './util'

export const SPONSOR_WORDS_PER_SEC = 2.5
export const LINE_WORDS: Record<CaptionStyle, number> = { bold_center: 3, karaoke: 3, minimal_bottom: 7 }
export const MAX_LINE_SEC = 2.0
export const LINE_TAIL_SEC = 0.3
export const LINE_GAP_SEC = 0.02

export type RawWord = { word?: string; w?: string; start?: number; end?: number; t0?: number; t1?: number }
export type Word = readonly [text: string, start: number, end: number]
type Line = { t0: number; t1: number; words: Word[] }

export function normWords(raw: readonly RawWord[]): Word[] {
  const out: Word[] = []
  for (const w of raw) {
    const text = String(w.word ?? w.w ?? '').trim()
    if (text) out.push([text, Number(w.start ?? w.t0 ?? 0), Number(w.end ?? w.t1 ?? 0)])
  }
  return out.sort((a, b) => a[1] - b[1] || a[2] - b[2])
}

/** Lines of at most 3 (bold_center/karaoke) or 7 (minimal_bottom) words and 2 s. */
export function groupLines(words: readonly Word[], style: string, maxWords: number | null = null): Word[][] {
  const limit = maxWords || LINE_WORDS[style as CaptionStyle] || 3
  const lines: Word[][] = []
  let current: Word[] = []
  for (const word of words) {
    if (current.length && (current.length >= limit || word[2] - current[0][1] > MAX_LINE_SEC)) {
      lines.push(current)
      current = []
    }
    current.push(word)
  }
  if (current.length) lines.push(current)
  return lines
}

function itemLines(item: Pick<VideoItem, 'src_in' | 'src_out' | 'tl_start'>, words: readonly Word[], style: string, maxWords: number | null): Line[] {
  const inside: Word[] = []
  for (const [text, start, end] of words) {
    const mid = (start + end) / 2
    if (item.src_in <= mid && mid < item.src_out) {
      const t0 = item.tl_start + Math.max(start, item.src_in) - item.src_in
      const t1 = item.tl_start + Math.min(Math.max(end, start), item.src_out) - item.src_in
      inside.push([text, t0, Math.max(t1, t0 + 0.01)])
    }
  }
  const itemEnd = item.tl_start + durationOf(item)
  const lines = groupLines(inside, style, maxWords)
  return lines.map((line, n) => {
    const t0 = line[0][1]
    const t1 = line[line.length - 1][2]
    const nxt = n + 1 < lines.length ? lines[n + 1][0][1] - LINE_GAP_SEC : itemEnd
    const end = Math.max(t1, Math.min(t1 + LINE_TAIL_SEC, nxt, itemEnd))
    return { t0: pyRound(t0, 3), t1: pyRound(Math.min(end, itemEnd), 3), words: line }
  })
}

export function estimateWords(text: string, duration: number): Word[] {
  const tokens = text.match(/\S+/g) ?? []
  const out: Word[] = []
  let cursor = 0
  const step = 1 / SPONSOR_WORDS_PER_SEC
  for (const token of tokens) {
    if (cursor >= duration - 1e-6) break
    out.push([token, pyRound(cursor, 3), pyRound(Math.min(cursor + step, duration), 3)])
    cursor += step
  }
  return out
}

export type WordsProvider = (assetId: string) => readonly RawWord[]

/** Replace the caption track with captions built from word timestamps (Plan 8.9). */
export function rebuildCaptions(
  t: Timeline,
  wordsProvider: WordsProvider,
  opts: { maxWords?: number | null; source?: 'ai' | 'user'; status?: LayerStatus } = {},
): Timeline {
  const { maxWords = null, source = 'ai', status = 'suggested' } = opts
  const out = cloneTimeline(t)
  const style = out.caption_style
  const cache = new Map<string, Word[]>()
  const captions: CaptionItem[] = []
  for (const item of active(out.tracks.video)) {
    let words: Word[]
    if (item.asset_id === null) {
      words = estimateWords(item.text ?? '', durationOf(item))
    } else {
      if (!cache.has(item.asset_id)) cache.set(item.asset_id, normWords(wordsProvider(item.asset_id)))
      words = cache.get(item.asset_id)!
    }
    const base = item.asset_id ? item : { ...item, src_in: 0 }
    for (const line of itemLines(base, words, style, maxWords)) {
      if (line.t1 - line.t0 < MIN_LAYER_SEC) continue
      captions.push({
        id: newItemId('c'),
        source: source === 'ai' ? 'ai' : 'user',
        status,
        reason: item.asset_id ? 'from transcript' : 'sponsor script',
        tl_start: line.t0,
        tl_end: line.t1,
        text: line.words.map((w) => w[0]).join(' '),
        words: line.words.map((w): CaptionWord => ({ w: w[0], t0: pyRound(w[1], 3), t1: pyRound(w[2], 3) })),
        style_override: null,
      })
    }
  }
  out.tracks.captions = captions
  return out
}

registerRebuildCaptions((t, ctx: OpContext, maxWords) => rebuildCaptions(t, ctx.wordsProvider!, { maxWords }))

/** Words per second used when redistributing edited caption text across its span. */
export function redistributeWords(text: string, tlStart: number, tlEnd: number): CaptionWord[] | null {
  const tokens = text.match(/\S+/g) ?? []
  if (!tokens.length) return null
  const span = Math.max(0.001, tlEnd - tlStart)
  const step = span / tokens.length
  return tokens.map((w, i) => ({ w, t0: pyRound(tlStart + i * step, 3), t1: pyRound(tlStart + (i + 1) * step, 3) }))
}

/**
 * New `words` for a caption whose text was edited. Same token count: keep each word's timing and swap the text.
 * Otherwise the timings are re-estimated evenly across the caption.
 */
export function wordsForEditedText(prev: readonly CaptionWord[] | null, text: string, tlStart: number, tlEnd: number): CaptionWord[] | null {
  const tokens = text.match(/\S+/g) ?? []
  if (prev && prev.length === tokens.length && tokens.length) return prev.map((w, i) => ({ w: tokens[i], t0: w.t0, t1: w.t1 }))
  return redistributeWords(text, tlStart, tlEnd)
}
