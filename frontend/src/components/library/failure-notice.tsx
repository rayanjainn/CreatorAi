'use client'

import { useRef } from 'react'
import { AlertCircle, FileText, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAttachTranscript, useReprocessAsset } from '@/lib/api/hooks'
import type { AssetAnalysis, AssetDetail } from '@/lib/api/types'

export function AttachTranscriptButton({ assetId, size = 'sm', variant = 'primary' }: { assetId: string; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' }) {
  const input = useRef<HTMLInputElement>(null)
  const attach = useAttachTranscript()
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".srt,.vtt,.json,.words.json"
        hidden
        aria-label="Transcript file (SRT, VTT or words.json)"
        data-testid="transcript-file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) attach.mutate({ id: assetId, file })
          e.target.value = ''
        }}
      />
      <Button size={size} variant={variant} loading={attach.isPending} onClick={() => input.current?.click()} data-testid="attach-transcript">
        <FileText size={13} /> Attach transcript
      </Button>
    </>
  )
}

/** Failure / canceled state of an asset with the actions that fix it (attach a transcript, retry). */
export function FailureNotice({ asset }: { asset: AssetDetail }) {
  const reprocess = useReprocessAsset()
  const analysis = asset.analysis as AssetAnalysis
  const canceled = asset.status === 'uploaded' && !!asset.error
  if (asset.status !== 'failed' && !canceled) return null
  const asr = analysis.error_code === 'ASR_UNAVAILABLE'
  const stage = analysis.failed_stage
  return (
    <div className="notice notice-red" role="alert" data-testid="failure-notice" data-code={analysis.error_code ?? ''}>
      <div className="stat-icon red">
        <AlertCircle size={16} />
      </div>
      <div className="notice-body">
        <b>{asr ? 'This file could not be transcribed' : canceled ? 'Processing was canceled' : `Processing failed${stage ? ` at “${stage}”` : ''}`}</b>
        <p>{asset.error ?? 'Something went wrong while processing this file.'}</p>
        {asr && <p className="notice-fine">Nothing was invented: without speech-to-text the transcript stays empty. Attach one you already have (SRT, VTT or words.json) and processing continues from there.</p>}
        <div className="notice-actions">
          {asr && <AttachTranscriptButton assetId={asset.id} />}
          <Button size="sm" variant={asr ? 'secondary' : 'primary'} loading={reprocess.isPending} onClick={() => reprocess.mutate({ id: asset.id })} data-testid="retry-asset">
            <RotateCw size={13} /> {canceled ? 'Resume' : 'Retry'}
          </Button>
        </div>
      </div>
    </div>
  )
}
