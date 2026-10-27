'use client'

import { useState } from 'react'
import { Download, Film, CheckCircle2, Loader2 } from 'lucide-react'
import { Button, LinkButton, buttonVariants } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { errorMessage } from '@/lib/api/errors'
import { mediaUrl } from '@/lib/api/client'
import { useDownloadYtdlp } from '@/lib/api/hooks'
import { formatBytes, formatDuration } from '@/lib/format'
import type { YtdlpDownloadOut } from '@/lib/api/types'
import { trackJob } from '@/lib/track-job'

function YoutubeIcon({ size = 15, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ color: '#ff0000', ...style }}
      aria-hidden="true"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

export function YoutubeDownloader() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<YtdlpDownloadOut | null>(null)
  const download = useDownloadYtdlp()

  const urlOk = /^https?:\/\/\S+\.\S+/i.test(url.trim())
  const errText = download.error ? errorMessage(download.error) : null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!urlOk || download.isPending) return
    setResult(null)
    download.mutate(
      { url: url.trim() },
      {
        onSuccess: (data) => {
          setResult(data)
          void trackJob(data.job_id)
        },
      }
    )
  }

  return (
    <div className="card sc-ytdlp" data-testid="ytdlp-card" style={{ display: 'grid', gap: '16px' }}>
      <div className="card-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow violet-text" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <YoutubeIcon size={14} /> yt-dlp Downloader
          </div>
          <h2>Download YouTube Video</h2>
          <p className="muted small" style={{ marginTop: '4px' }}>
            Paste a link to a video you own or may reuse. It is saved to your library and analysed like any upload.
          </p>
        </div>
      </div>

      <form onSubmit={submit} style={{ display: 'grid', gap: '12px' }}>
        <Field label="YouTube Link" htmlFor="yt-url" hint="Supports youtube.com/watch, youtu.be, and shorts links">
          <div className="sc-url">
            <YoutubeIcon size={15} />
            <Input
              id="yt-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              data-testid="ytdlp-url-input"
            />
          </div>
        </Field>

        {errText && (
          <p className="field-error" role="alert" data-testid="ytdlp-error">
            {errText}
          </p>
        )}

        {download.isPending && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'var(--surface-2)',
              border: '1px solid #3b82f644',
              color: '#93c5fd',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <Loader2 className="animate-spin" size={16} />
            <span>Downloading video with <code>yt-dlp</code>… This takes a few seconds depending on video size.</span>
          </div>
        )}

        <Button
          type="submit"
          block
          loading={download.isPending}
          disabled={!urlOk || download.isPending}
          data-testid="ytdlp-submit-btn"
        >
          {download.isPending ? (
            'Downloading video with yt-dlp…'
          ) : (
            <>
              <Download size={15} /> Download YouTube Video
            </>
          )}
        </Button>
      </form>

      {result && (
        <div className="sc-ytdlp-result" data-testid="ytdlp-result">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4ade80' }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
            <strong style={{ fontSize: '13.5px' }}>
              {result.duplicate ? 'Video Already in Library' : 'Successfully Downloaded!'}
            </strong>
          </div>

          <div style={{ display: 'grid', gap: '8px', minWidth: 0 }}>
            <h3 className="sc-ytdlp-title" title={result.title}>{result.title}</h3>
            <div className="sc-ytdlp-meta-row">
              {result.duration_sec ? (
                <span className="sc-ytdlp-chip">Duration: {formatDuration(result.duration_sec)}</span>
              ) : null}
              <span className="sc-ytdlp-chip">Size: {formatBytes(result.size_bytes)}</span>
            </div>
            <div className="sc-ytdlp-filename" title={result.filename}>
              File: {result.filename}
            </div>
          </div>

          {result.stream_url && (
            <div style={{ borderRadius: '10px', overflow: 'hidden', background: '#000', maxHeight: '200px', width: '100%' }}>
              <video
                src={mediaUrl(result.stream_url) ?? undefined}
                controls
                style={{ width: '100%', maxHeight: '200px', objectFit: 'contain', display: 'block' }}
              />
            </div>
          )}

          <div className="sc-ytdlp-actions">
            <a
              className={buttonVariants({ block: true })}
              href={mediaUrl(result.download_url) ?? undefined}
              download={result.filename}
              data-testid="ytdlp-download-file-btn"
            >
              <Download size={15} /> Save to computer
            </a>
            <LinkButton href={`/assets?asset=${result.asset_id}`} block variant="secondary">
              <Film size={15} /> Open in library
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  )
}
