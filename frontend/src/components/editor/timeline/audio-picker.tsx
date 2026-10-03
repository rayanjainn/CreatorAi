'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { Music, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { api, unwrap } from '@/lib/api/client'
import { qk, useAssets } from '@/lib/api/hooks'
import type { AssetDetail } from '@/lib/api/types'
import { addAudioLayer } from '@/lib/editor/actions'
import { assetToEditAsset } from '@/lib/editor/api'
import { formatDuration } from '@/lib/format'
import { toast } from '@/stores/toasts'
import { useEditor } from '@/stores/editor'
import type { AudioKind } from '@/lib/timeline'

/** Pick a ready audio asset from the library and drop it on the audio track at the playhead. */
export function AudioPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useAssets({ kind: 'audio', status: 'ready', limit: 60 }, { enabled: open })
  const qc = useQueryClient()
  const [kinds, setKinds] = useState<Record<string, AudioKind>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const add = async (id: string, duration: number | null, kind: AudioKind) => {
    setBusy(id)
    try {
      const detail = await qc.fetchQuery({
        queryKey: qk.asset(id),
        queryFn: () => unwrap(api.GET('/api/v1/assets/{asset_id}', { params: { path: { asset_id: id }, query: { include_energy: true } } })) as Promise<AssetDetail>,
        staleTime: 60_000,
      })
      useEditor.getState().mergeAssets({ [id]: assetToEditAsset(detail) })
      addAudioLayer({ assetId: id, kind, duration: detail.duration_sec ?? duration ?? 0 })
      onOpenChange(false)
    } catch (e) {
      toast.error('Could not add that audio', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="md" eyebrow="Audio" title="Add music or sound" description="Ready audio files from your asset library. The layer is added at the playhead; music is cut to the length of the video.">
      <div className="audio-picker" data-testid="audio-picker">
        {q.isPending && (
          <>
            <Skeleton style={{ height: 56 }} />
            <Skeleton style={{ height: 56 }} />
          </>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
        {q.data && q.data.items.length === 0 && (
          <EmptyState
            compact
            icon={<Music size={20} />}
            title="No audio in your library yet"
            description="Upload an mp3, wav or m4a to the asset library, wait for it to finish processing, then come back."
            actions={
              <Link href="/assets" className="button button-secondary button-sm">
                Open the asset library
              </Link>
            }
          />
        )}
        {q.data?.items.map((a) => {
          const kind = kinds[a.id] ?? 'music'
          return (
            <div className="audio-row" key={a.id} data-testid="audio-option">
              <div className="stat-icon cyan">
                <Music size={15} />
              </div>
              <div className="audio-row-main">
                <b className="truncate">{a.filename}</b>
                <small className="mono">{a.duration_sec ? `${formatDuration(a.duration_sec)} (${a.duration_sec.toFixed(1)}s)` : 'duration unknown'}</small>
              </div>
              <Select value={kind} onChange={(e) => setKinds((k) => ({ ...k, [a.id]: e.target.value as AudioKind }))} aria-label={`Use ${a.filename} as`} style={{ width: 118 }}>
                <option value="music">Music</option>
                <option value="sfx">Sound effect</option>
                <option value="voiceover">Voiceover</option>
              </Select>
              <Button size="sm" onClick={() => void add(a.id, a.duration_sec, kind)} loading={busy === a.id} disabled={!a.duration_sec} data-testid="add-audio-asset">
                <Plus size={13} /> Add
              </Button>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
