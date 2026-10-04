'use client'

import { useProjectRole } from '@/lib/use-role'
import Link from 'next/link'
import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Film, FolderPlus, Play, Unlink } from 'lucide-react'
import { UploadZone } from '@/components/library/upload-zone'
import { UploadDialog } from '@/components/library/upload-dialog'
import { UploadPill } from '@/components/library/upload-pill'
import { AssetCard } from '@/components/library/asset-card'
import { AssetDetailHost } from '@/components/library/asset-detail'
import { AssetGridSkeleton } from '@/components/library/asset-grid'
import { useAssetDrawer } from '@/components/library/use-asset-drawer'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup } from '@/components/ui/menu'
import { qk, useAssets, useContentItem, usePatchAsset, useRunMatch } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { enqueueUploads } from '@/lib/upload'
import { longestReadyVideo } from '@/lib/library'
import { useProjectUi } from '@/stores/project-ui'
import type { Card } from '@/lib/api/types'

export default function FootagePage({ params }: { params: Promise<{ id: string }> }) {
  const { canEdit } = useProjectRole(use(params).id)
  const { id } = use(params)
  const router = useRouter()
  const qc = useQueryClient()
  const item = useContentItem(id)
  const card = item.data as Card | undefined
  const attached = useAssets({ content_item_id: id, limit: 200, sort: 'created_at' })
  const library = useAssets({ limit: 200 })
  const patch = usePatchAsset()
  const run = useRunMatch(id)
  const drawer = useAssetDrawer()
  const [uploadOpen, setUploadOpen] = useState(false)
  const primary = useProjectUi((s) => s.primary[id])
  const setPrimary = useProjectUi((s) => s.setPrimary)
  const hydrate = useProjectUi((s) => s.hydrate)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  const assets = attached.data?.items ?? []
  const unattached = useMemo(() => (library.data?.items ?? []).filter((a) => !a.content_item_id && a.status === 'ready').slice(0, 25), [library.data])
  const effectivePrimary = assets.find((a) => a.id === primary && a.status === 'ready') ?? longestReadyVideo(assets)
  const readyCount = assets.filter((a) => a.status === 'ready').length

  const onFiles = (files: File[]) => {
    setUploadOpen(true)
    enqueueUploads(files, id, () => {
      void qc.invalidateQueries({ queryKey: qk.assetsAll })
      void qc.invalidateQueries({ queryKey: qk.contentItem(id) })
    })
  }

  if (attached.isError) return <ErrorState error={attached.error} onRetry={() => attached.refetch()} title="Could not load the footage" />
  const err = run.error

  return (
    <div className="stack" data-testid="footage-page">
      <section className="card">
        <div className="card-heading">
          <div>
            <div className="eyebrow violet-text">Footage</div>
            <h2>Add footage to this project</h2>
          </div>
          <div className="page-actions">
            {canEdit && <UploadPill contentItemId={id} onOpen={() => setUploadOpen(true)} />}
            <Menu.Root>
              <Menu.Trigger className="button button-secondary button-sm" data-testid="add-from-library">
                <FolderPlus size={13} /> Add from library
              </Menu.Trigger>
              <MenuPopup className="switcher-popup">
                {unattached.length === 0 ? (
                  <div className="menu-head">
                    <small>No unattached ready assets in your library</small>
                  </div>
                ) : (
                  unattached.map((a) => (
                    <MenuItem key={a.id} onClick={() => patch.mutate({ id: a.id, patch: { content_item_id: id } }, { onSuccess: () => qc.invalidateQueries({ queryKey: qk.contentItem(id) }) })}>
                      <Film size={13} /> <span className="truncate" style={{ maxWidth: 260 }}>{a.filename}</span>
                    </MenuItem>
                  ))
                )}
              </MenuPopup>
            </Menu.Root>
          </div>
        </div>
        {canEdit && <div style={{ marginTop: 14 }}>
          <UploadZone compact onFiles={onFiles} title="Drop this project's footage" hint="It is transcribed and indexed as soon as it uploads, and linked to this project." />
        </div>}
      </section>

      <section className="card">
        <div className="card-heading">
          <div>
            <div className="eyebrow violet-text">{assets.length} attached</div>
            <h2>Project assets</h2>
          </div>
          <div className="page-actions">
            <Button
              onClick={() =>
                run.mutate(undefined, {
                  onSuccess: () => router.push(`/projects/${id}/match`),
                })
              }
              loading={run.isPending}
              disabled={!card?.progress.has_script || readyCount === 0}
              title={!card?.progress.has_script ? 'Write a script first' : readyCount === 0 ? 'Wait for a ready asset with a transcript' : undefined}
              data-testid="run-matching"
            >
              <Play size={14} /> Run matching
            </Button>
          </div>
        </div>
        {isCode(err, 'NO_SCRIPT', 'ASSET_NOT_READY') && (
          <div className="notice notice-amber mt" role="alert" data-testid="matching-error">
            <div className="stat-icon amber">
              <AlertTriangle size={15} />
            </div>
            <div className="notice-body">
              <b>Matching can not start yet</b>
              <p>{err.message}</p>
              {isCode(err, 'NO_SCRIPT') && (
                <div className="notice-actions">
                  <Link href={`/projects/${id}/script`} className="button button-secondary button-sm">
                    Go to the script
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
        {!card?.progress.has_script && <p className="muted small" style={{ marginTop: 10 }}>Matching needs a script. <Link href={`/projects/${id}/script`} className="link">Write one</Link>.</p>}
        <div style={{ marginTop: 14 }}>
          {attached.isPending ? (
            <AssetGridSkeleton view="list" />
          ) : assets.length === 0 ? (
            <EmptyState compact icon={<Film size={20} />} title="No footage yet" description="Upload clips above, or attach ones you already have in the library." />
          ) : (
            <div className="asset-list" data-testid="project-assets">
              {assets.map((a) => (
                <AssetCard
                  key={a.id}
                  asset={a}
                  variant="list"
                  onOpen={(aid) => drawer.open(aid)}
                  extra={
                    <div className="footage-actions">
                      {a.kind === 'video' && a.status === 'ready' && (
                        <label className="primary-pick" data-active={effectivePrimary?.id === a.id}>
                          <input type="radio" name="primary-video" checked={effectivePrimary?.id === a.id} onChange={() => setPrimary(id, a.id)} data-testid="primary-radio" />
                          Primary video
                        </label>
                      )}
                      <button type="button" className="icon-button" aria-label={`Detach ${a.filename} from this project`} title="Detach from project" onClick={() => patch.mutate({ id: a.id, patch: { content_item_id: null } })}>
                        <Unlink size={14} />
                      </button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </div>
        {assets.some((a) => a.kind === 'video' && a.status === 'ready') && (
          <p className="muted small" style={{ marginTop: 12 }}>
            The primary video is the source for “Generate clips”. It is remembered in this browser only; without a choice the longest ready video is used.
          </p>
        )}
      </section>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} contentItemId={id} onOpenAsset={(aid) => drawer.open(aid)} />
      <AssetDetailHost />
    </div>
  )
}
