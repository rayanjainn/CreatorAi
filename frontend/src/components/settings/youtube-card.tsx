'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, RefreshCw, Unplug, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { CopyButton } from '@/components/common/copy-button'
import { errorMessage } from '@/lib/api/errors'
import { useConnectYoutube, useDisconnectYoutube, useSyncYoutube, useYoutubeStatus } from '@/lib/api/publishing'
import { relativeTime } from '@/lib/time'

/** Settings: connect a YouTube channel (admins), see which one is connected, disconnect or sync stats. */
export function YoutubeCard({ canAdmin }: { canAdmin: boolean }) {
  const status = useYoutubeStatus()
  const connect = useConnectYoutube()
  const disconnect = useDisconnectYoutube()
  const sync = useSyncYoutube()
  const params = useSearchParams()
  const [confirm, setConfirm] = useState(false)
  const outcome = params.get('youtube')
  const message = params.get('message')
  const s = status.data
  const { refetch } = status

  useEffect(() => {
    if (outcome) void refetch()
  }, [outcome, refetch])

  return (
    <section className="card" id="youtube" aria-labelledby="yt-h" data-testid="youtube-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow">Publishing</div>
          <h2 id="yt-h">YouTube</h2>
        </div>
        {s?.connected && (
          <span className="yt-connected">
            <CheckCircle2 size={14} aria-hidden /> Connected
          </span>
        )}
      </div>
      {outcome === 'connected' && (
        <p className="auth-alert info" role="status">
          Channel connected. You can publish renders from a project&apos;s Publish tab.
        </p>
      )}
      {(outcome === 'error' || outcome === 'denied') && (
        <p className="field-error" role="alert" data-testid="youtube-error">
          {message || 'Connecting did not finish.'}
        </p>
      )}
      {!s ? (
        status.isError ? <p className="field-error">{errorMessage(status.error)}</p> : <Skeleton style={{ height: 70, marginTop: 14 }} />
      ) : !s.configured ? (
        <div className="yt-setup" data-testid="youtube-setup">
          <p className="muted small">
            Publishing uses your own Google OAuth client (free). In the Google Cloud console create a project, enable the <b>YouTube Data API v3</b>, create an
            OAuth client of type <b>Web application</b> with this redirect URI, then put its id and secret in <code className="env">.env</code> and restart the API:
          </p>
          <div className="yt-uri">
            <code>{s.redirect_uri}</code>
            <CopyButton text={s.redirect_uri} label="Copy the redirect URI" />
          </div>
          <p className="muted small">
            <code className="env">GOOGLE_CLIENT_ID</code> <code className="env">GOOGLE_CLIENT_SECRET</code>. While the Google app is in testing mode, add your account as a test
            user; Google may keep uploads from unverified apps private.
          </p>
        </div>
      ) : s.connected ? (
        <div className="yt-row">
          <Video size={18} aria-hidden />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b data-testid="youtube-channel">{s.channel_title || s.channel_id}</b>
            <p className="muted small">
              Connected {s.connected_at ? relativeTime(s.connected_at) : ''}
              {s.last_sync_at ? ` · stats synced ${relativeTime(s.last_sync_at)}` : ''}
            </p>
          </div>
          <div className="mon-row">
            <Button size="sm" variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending}>
              <RefreshCw size={13} /> Sync stats
            </Button>
            {canAdmin && (
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                <Unplug size={13} /> Disconnect
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="yt-row">
          <Video size={18} aria-hidden />
          <p className="muted small" style={{ flex: 1 }}>
            {s.status === 'revoked' ? 'Access to the channel was revoked or expired. Connect it again.' : 'No channel connected. Connect one to publish renders and see real views in Insights.'}
          </p>
          {canAdmin ? (
            <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending} data-testid="youtube-connect">
              Connect YouTube
            </Button>
          ) : (
            <span className="muted small">An admin can connect it.</span>
          )}
        </div>
      )}
      {connect.error && <p className="field-error">{errorMessage(connect.error)}</p>}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect YouTube?"
        description="CreatorAi forgets the channel and asks Google to revoke its access. Videos already on YouTube stay there."
        confirmLabel="Disconnect"
        danger
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate(undefined, { onSuccess: () => setConfirm(false) })}
      />
    </section>
  )
}
