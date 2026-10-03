'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, Clock3 } from 'lucide-react'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Thumb } from '@/components/common/thumb'
import { AssetStatusChip, useLiveProgress } from './status-chip'
import { KIND_META, kindOf } from '@/lib/library'
import { formatBytes, formatDuration } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import type { Asset } from '@/lib/api/types'

type Props = { asset: Asset; onOpen: (id: string) => void; index?: number; variant?: 'grid' | 'list'; extra?: React.ReactNode }

const WARN_LABEL: Record<string, string> = { CAPTIONS_UNAVAILABLE: 'AI captions off' }

function Warnings({ asset }: { asset: Asset }) {
  if (!asset.warnings.length) return null
  return (
    <>
      {asset.warnings.slice(0, 2).map((w) => (
        <span key={w.code} className="badge badge-amber" title={w.message} data-testid="asset-warning" data-code={w.code}>
          <AlertTriangle size={10} aria-hidden /> {WARN_LABEL[w.code] ?? w.code.toLowerCase().replace(/_/g, ' ')}
        </span>
      ))}
    </>
  )
}

/** Library tile (grid) or row (list): poster, type, duration, live status, tags, provenance, warnings. */
export function AssetCard({ asset, onOpen, index = 0, variant = 'grid', extra }: Props) {
  const kind = kindOf(asset)
  const { Icon, label } = KIND_META[kind]
  const pct = useLiveProgress(asset)
  const failed = asset.status === 'failed'
  const open = () => onOpen(asset.id)
  const poster = (
    <Thumb src={asset.thumb_url} iconSize={22}>
      <div className="thumb-overlay" />
      <span className="kind-chip">
        <Icon size={11} aria-hidden /> {label}
      </span>
      {asset.duration_sec ? <span className="dur-chip mono">{formatDuration(asset.duration_sec)}</span> : null}
      {pct !== null && (
        <div className="thumb-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Processing progress">
          <i style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      )}
    </Thumb>
  )

  if (variant === 'list') {
    return (
      <div className="asset-row" data-testid="asset-card" data-status={asset.status}>
        <button type="button" className="asset-open" onClick={open} aria-label={`Open ${asset.filename}`}>
          {poster}
        </button>
        <div className="asset-row-main">
          <button type="button" className="asset-title" onClick={open}>
            <span className="truncate">{asset.filename}</span>
          </button>
          <div className="asset-sub">
            <span className="mono">{formatBytes(asset.size_bytes)}</span>
            <span>
              <Clock3 size={11} aria-hidden /> {relativeTime(asset.created_at)}
            </span>
            {failed && asset.error && <span className="asset-error truncate">{asset.error}</span>}
          </div>
          <div className="tag-row">
            {asset.tags.slice(0, 5).map((t) => (
              <span key={t} className="badge badge-gray">
                {t}
              </span>
            ))}
            <Warnings asset={asset} />
          </div>
        </div>
        <div className="asset-row-side">
          <AssetStatusChip asset={asset} />
          <ProvenanceBadge {...asset.provenance} />
          {extra}
        </div>
      </div>
    )
  }

  return (
    <motion.div
      className="asset-card"
      data-testid="asset-card"
      data-status={asset.status}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.035, duration: 0.25 }}
      whileHover={{ y: -3 }}
    >
      <button type="button" className="asset-open" onClick={open} aria-label={`Open ${asset.filename}`}>
        {poster}
      </button>
      <div className="asset-info">
        <div className="asset-info-top">
          <button type="button" className="asset-title" onClick={open} title={asset.filename}>
            <span className="truncate">{asset.filename}</span>
          </button>
        </div>
        <div className="asset-sub">
          <span className="mono">{formatBytes(asset.size_bytes)}</span>
          <span>
            <Clock3 size={11} aria-hidden /> {relativeTime(asset.created_at)}
          </span>
        </div>
        <div className="asset-badges">
          <AssetStatusChip asset={asset} />
          <ProvenanceBadge {...asset.provenance} />
        </div>
        {failed && asset.error && <p className="asset-error">{asset.error}</p>}
        {(asset.tags.length > 0 || asset.warnings.length > 0) && (
          <div className="tag-row">
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t} className="badge badge-gray">
                {t}
              </span>
            ))}
            {asset.tags.length > 3 && <span className="badge badge-gray">+{asset.tags.length - 3}</span>}
            <Warnings asset={asset} />
          </div>
        )}
      </div>
    </motion.div>
  )
}
