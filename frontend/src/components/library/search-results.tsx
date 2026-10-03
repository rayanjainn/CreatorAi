'use client'

import { motion } from 'framer-motion'
import { Eye, Mic, Play } from 'lucide-react'
import { Thumb } from '@/components/common/thumb'
import { Button } from '@/components/ui/button'
import { highlightParts } from '@/lib/library'
import { formatRange, formatTimecode } from '@/lib/format'
import type { SearchHit } from '@/lib/api/types'

/** One matching moment: thumbnail, timecode, highlighted snippet, speech/visual chip, jump button. */
export function MomentCard({ hit, query, onJump, index = 0 }: { hit: SearchHit; query: string; onJump: (assetId: string, t: number) => void; index?: number }) {
  const speech = hit.kind === 'speech'
  const KindIcon = speech ? Mic : Eye
  return (
    <motion.article
      className="moment-card"
      data-testid="moment-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.22 }}
    >
      <button type="button" className="moment-thumb" onClick={() => onJump(hit.asset_id, hit.start_sec)} aria-label={`Jump to ${formatTimecode(hit.start_sec)} in ${hit.filename}`}>
        <Thumb src={hit.thumb_url} iconSize={20}>
          <span className="dur-chip mono">{formatTimecode(hit.start_sec)}</span>
          <span className="moment-play" aria-hidden>
            <Play size={16} />
          </span>
        </Thumb>
      </button>
      <div className="moment-body">
        <div className="moment-top">
          <b className="truncate" title={hit.filename}>
            {hit.filename}
          </b>
          <span className="mono muted" data-testid="moment-time">
            {formatRange(hit.start_sec, hit.end_sec)}
          </span>
        </div>
        <p className="moment-snippet">{highlightParts(hit.snippet, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}</p>
        <div className="moment-foot">
          <span className="badge badge-gray" data-testid="moment-kind" data-kind={hit.kind}>
            <KindIcon size={10} aria-hidden /> {speech ? 'Speech' : 'Visual'}
          </span>
          <span className="badge badge-gray">{hit.similarity != null ? `${Math.round(hit.similarity * 100)}% similar` : 'keyword match'}</span>
          <Button size="sm" variant="secondary" style={{ marginLeft: 'auto' }} onClick={() => onJump(hit.asset_id, hit.start_sec)} data-testid="jump-to-moment">
            <Play size={12} /> Jump to moment
          </Button>
        </div>
      </div>
    </motion.article>
  )
}
