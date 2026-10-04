'use client'

import Link from 'next/link'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { BookmarkPlus, Check, Download, ExternalLink, Gauge, Play, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { useExportLumiclipClip, useImportLumiclipClip } from '@/lib/api/hooks'
import { formatDuration } from '@/lib/format'
import { toast } from '@/stores/toasts'
import type { LumiclipClip, LumiclipProject } from '@/lib/api/types'

/** One clip cut by LumiClip: preview it, save it to your library (then edit and export it like any asset), or download it. */
export function LumiClipCard({ project, clip, index }: { project: LumiclipProject; clip: LumiclipClip; index: number }) {
  const [open, setOpen] = useState(false)
  const save = useImportLumiclipClip()
  const hd = useExportLumiclipClip()
  const ready = clip.status === 'completed' && !!clip.download_url
  const pct = Math.round(clip.score * 100)
  const saved = clip.imported_asset_id

  return (
    <motion.article className="sc-clip" data-testid="lumiclip-clip" data-ready={ready} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.25 }}>
      <button type="button" className="sc-clip-thumb" onClick={() => ready && setOpen(true)} disabled={!ready} aria-label={ready ? `Preview ${clip.title}` : `${clip.title} is still being cut`} style={clip.thumbnail_url ? { backgroundImage: `url(${clip.thumbnail_url})` } : undefined}>
        {ready ? <Play size={22} fill="currentColor" /> : <span className="sc-clip-wait">Cutting…</span>}
        <span className="sc-clip-dur mono">{formatDuration(clip.duration)}</span>
        <span className="sc-clip-score" title="LumiClip's score for how well this moment should perform">
          <Gauge size={11} /> {pct}
        </span>
      </button>
      <div className="sc-clip-body">
        <h3 title={clip.title}>{clip.title}</h3>
        {clip.reason && (
          <p className="sc-clip-reason">
            <Sparkles size={12} aria-hidden /> {clip.reason}
          </p>
        )}
        <div className="sc-clip-meta">
          <ProvenanceBadge source="ai" provider="lumiclip" />
          {clip.quality && <span className="badge badge-gray">{clip.quality}</span>}
        </div>
        <div className="sc-clip-actions">
          {saved ? (
            <Link href={`/assets?asset=${saved}`} className="button button-secondary button-sm" data-testid="clip-saved">
              <Check size={13} /> In your library
            </Link>
          ) : (
            <Button size="sm" disabled={!ready} loading={save.isPending} onClick={() => save.mutate({ projectId: project.id, clipId: clip.id }, { onSuccess: (o) => toast.success(o.duplicate ? 'Already in your library' : 'Saved to your library', 'Open it in the editor from the Media tab.') })} data-testid="clip-save">
              <BookmarkPlus size={13} /> Save to library
            </Button>
          )}
          {ready && (
            <a className="button button-ghost button-sm" href={clip.download_url ?? '#'} target="_blank" rel="noopener noreferrer" download>
              <Download size={13} /> Download
            </a>
          )}
        </div>
      </div>

      <Modal open={open} onOpenChange={setOpen} size="lg" eyebrow="LumiClip" title={clip.title} description={clip.reason || undefined}>
        <div className="sc-preview">
          <video src={clip.download_url ?? undefined} poster={clip.thumbnail_url ?? undefined} controls autoPlay playsInline data-aspect={project.aspect_ratio} />
        </div>
        <div className="sc-preview-actions">
          <Button
            variant="secondary"
            size="sm"
            loading={hd.isPending}
            onClick={() =>
              hd.mutate(
                { projectId: project.id, clipId: clip.id, quality: '1080p' },
                { onSuccess: (r) => (r.url ? window.open(r.url, '_blank', 'noopener,noreferrer') : toast.info('Rendering in HD', `LumiClip says about ${r.estimated_seconds ?? 30} s. Try again in a moment.`)) },
              )
            }
          >
            <ExternalLink size={13} /> Get the 1080p file
          </Button>
        </div>
      </Modal>
    </motion.article>
  )
}
