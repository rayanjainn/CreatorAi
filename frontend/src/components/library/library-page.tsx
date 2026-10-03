'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, FolderOpen, LayoutGrid, List, Search as SearchIcon, UploadCloud } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Segmented } from '@/components/common/segmented'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { AssetGrid, AssetGridSkeleton } from './asset-grid'
import { AssetDetailHost } from './asset-detail'
import { MomentCard } from './search-results'
import { SearchBar } from './search-bar'
import { UploadDialog } from './upload-dialog'
import { UploadPill } from './upload-pill'
import { useAssetDrawer } from './use-asset-drawer'
import { useAssets, useSearch } from '@/lib/api/hooks'
import { enqueueUploads } from '@/lib/upload'
import { plural } from '@/lib/format'
import type { AssetKind, AssetStatus } from '@/lib/api/types'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/api/hooks'

type TypeFilter = 'all' | AssetKind
const SORTS = [
  { value: '-created_at', label: 'Newest first' },
  { value: 'created_at', label: 'Oldest first' },
  { value: 'filename', label: 'Name A to Z' },
  { value: '-duration', label: 'Longest first' },
  { value: '-size', label: 'Largest first' },
  { value: 'status', label: 'Status' },
]
const VIEW_KEY = 'creatorai.library.view'

const viewListeners = new Set<() => void>()
function readView(): 'grid' | 'list' {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}
/** Grid/list preference in localStorage (SSR-safe: the server snapshot is always `grid`). */
function useViewPref(): 'grid' | 'list' {
  return useSyncExternalStore(
    (cb) => {
      viewListeners.add(cb)
      return () => void viewListeners.delete(cb)
    },
    readView,
    () => 'grid',
  )
}
function writeView(v: 'grid' | 'list') {
  try {
    window.localStorage.setItem(VIEW_KEY, v)
  } catch {
    /* private mode: the choice just is not remembered */
  }
  viewListeners.forEach((l) => l())
}

/**
 * Library (`/assets`) and full-page search (`/search`). The query lives in the URL (`?q=`) so the topbar search,
 * links and reloads all land in the same place; filters are local.
 */
export function LibraryPage({ variant }: { variant: 'library' | 'search' }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const qc = useQueryClient()
  const q = (params.get('q') ?? '').trim()
  const [text, setText] = useState(q)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [type, setType] = useState<TypeFilter>('all')
  const [status, setStatus] = useState<'all' | AssetStatus>('all')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('-created_at')
  const [matchKind, setMatchKind] = useState<'any' | 'speech' | 'visual'>('any')
  const view = useViewPref()
  const [dragging, setDragging] = useState(false)
  const drawer = useAssetDrawer()

  const [seenQ, setSeenQ] = useState(q)
  if (seenQ !== q) {
    setSeenQ(q)
    setText(q)
  }

  const setQuery = useCallback(
    (v: string) => {
      const next = new URLSearchParams(params.toString())
      if (v.trim()) next.set('q', v.trim())
      else next.delete('q')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  // Debounced live search while typing (Enter submits immediately).
  useEffect(() => {
    if (text.trim() === q) return
    const t = setTimeout(() => setQuery(text), 450)
    return () => clearTimeout(t)
  }, [text, q, setQuery])

  const searching = q.length > 0
  const everything = useAssets({ limit: 200, sort: '-created_at' })
  const tags = useMemo(() => Array.from(new Set((everything.data?.items ?? []).flatMap((a) => a.tags))).sort((a, b) => a.localeCompare(b)), [everything.data])
  const assetById = useMemo(() => new Map((everything.data?.items ?? []).map((a) => [a.id, a])), [everything.data])

  const list = useAssets({ kind: type === 'all' ? undefined : type, status: status === 'all' ? undefined : status, tag: tag || undefined, sort, limit: 100 }, { enabled: !searching })
  const searchable = type === 'all' || type === 'video' || type === 'audio' || type === 'image'
  const search = useSearch(q, { asset_kind: type === 'video' || type === 'audio' || type === 'image' ? type : undefined, kind: matchKind === 'any' ? undefined : matchKind })

  const hits = useMemo(() => {
    const raw = search.data?.results ?? []
    return raw.filter((h) => {
      const a = assetById.get(h.asset_id)
      if (status !== 'all' && a && a.status !== status) return false
      if (tag && a && !a.tags.includes(tag)) return false
      return true
    })
  }, [search.data, assetById, status, tag])
  const assetCount = new Set(hits.map((h) => h.asset_id)).size

  const onFiles = (files: File[]) => {
    setUploadOpen(true)
    enqueueUploads(files, undefined, () => {
      void qc.invalidateQueries({ queryKey: qk.assetsAll })
      void qc.invalidateQueries({ queryKey: qk.boardAll })
    })
  }

  const hasFilters = type !== 'all' || status !== 'all' || !!tag

  return (
    <div
      className="page"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) {
          e.preventDefault()
          onFiles(files)
        }
      }}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <UploadCloud size={30} /> Drop to upload
        </div>
      )}
      <PageHeader
        eyebrow={variant === 'library' ? 'CreatorAI / Library' : 'CreatorAI / Search'}
        title={variant === 'library' ? 'Asset Library' : 'Search your footage'}
        description={
          variant === 'library'
            ? 'Every clip you upload is transcribed, split into shots and indexed, so you can find a moment by describing it.'
            : 'Hybrid semantic and keyword search over every transcript and shot caption. Jump straight to the second that matches.'
        }
        actions={
          <>
            <UploadPill onOpen={() => setUploadOpen(true)} />
            <Button onClick={() => setUploadOpen(true)} data-testid="open-upload">
              <UploadCloud size={15} /> Upload
            </Button>
          </>
        }
      />

      <SearchBar value={text} onChange={setText} onSubmit={() => setQuery(text)} busy={searching && search.isFetching} autoFocus={variant === 'search'} />

      <div className="toolbar" data-testid="library-filters">
        <div className="toolbar-group">
          <Segmented<TypeFilter>
            label="Filter by type"
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'video', label: 'Video' },
              { value: 'audio', label: 'Audio' },
              { value: 'image', label: 'Image' },
              { value: 'document', label: 'Docs' },
            ]}
          />
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as 'all' | AssetStatus)} style={{ width: 150, minHeight: 36 }}>
            <option value="all">Any status</option>
            <option value="ready">Ready</option>
            <option value="processing">Processing</option>
            <option value="uploaded">Queued</option>
            <option value="failed">Failed</option>
          </Select>
          <Select aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 150, minHeight: 36 }} disabled={tags.length === 0}>
            <option value="">{tags.length ? 'Any tag' : 'No tags yet'}</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          {searching && (
            <Segmented<'any' | 'speech' | 'visual'>
              label="Match kind"
              value={matchKind}
              onChange={setMatchKind}
              options={[
                { value: 'any', label: 'Any match' },
                { value: 'speech', label: 'Speech' },
                { value: 'visual', label: 'Visual' },
              ]}
            />
          )}
        </div>
        {!searching && (
          <div className="toolbar-group">
            <Select aria-label="Sort assets" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 160, minHeight: 36 }}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <div className="segmented" role="group" aria-label="View">
              {(['grid', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                  aria-pressed={view === v}
                  className={view === v ? 'selected' : ''}
                  onClick={() => writeView(v)}
                >
                  {v === 'grid' ? <LayoutGrid size={14} /> : <List size={14} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {searching ? (
        <section className="search-section" aria-live="polite" data-testid="search-results">
          {!searchable ? (
            <EmptyState compact title="Documents are not searched by moment" description="Search covers speech and shots in video and audio, and captions of images. Browse documents without a query." />
          ) : search.isPending ? (
            <div className="moment-list">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} style={{ height: 130, borderRadius: 14 }} />
              ))}
            </div>
          ) : search.isError ? (
            <ErrorState error={search.error} onRetry={() => search.refetch()} title="Search failed" />
          ) : (
            <>
              <div className="result-head">
                <span>
                  <b data-testid="result-count">{plural(hits.length, 'moment')}</b> in {plural(assetCount, 'asset')} for “{q}”
                </span>
                <ProvenanceBadge {...search.data.provenance} />
                <button type="button" className="link-button" onClick={() => setQuery('')}>
                  Clear search
                </button>
              </div>
              {search.data.warnings.length > 0 && (
                <div className="notice notice-amber" data-testid="search-warnings">
                  <div className="stat-icon amber">
                    <AlertTriangle size={15} />
                  </div>
                  <div className="notice-body">
                    {search.data.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                </div>
              )}
              {hits.length === 0 ? (
                <EmptyState
                  icon={<SearchIcon size={22} />}
                  title="No moment matches"
                  description={hasFilters ? 'Try removing a filter, or describe the moment differently.' : 'Nothing in your library says or shows that yet. Try other words, or upload more footage.'}
                  actions={hasFilters ? <Button variant="secondary" onClick={() => { setType('all'); setStatus('all'); setTag('') }}>Clear filters</Button> : undefined}
                />
              ) : (
                <div className="moment-list">
                  {hits.map((h, i) => (
                    <MomentCard key={`${h.asset_id}-${h.start_sec}-${i}`} hit={h} query={q} index={i} onJump={(id, t) => drawer.open(id, t)} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      ) : list.isPending ? (
        <AssetGridSkeleton view={view} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} title="Could not load the library" />
      ) : list.data.items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<FolderOpen size={22} />}
            title="No assets match these filters"
            description="Change or clear the filters to see everything."
            actions={<Button variant="secondary" onClick={() => { setType('all'); setStatus('all'); setTag('') }}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={<UploadCloud size={22} />}
            title="Your library is empty"
            description="Drop video, audio or images here. CreatorAi transcribes them, finds the shots and indexes everything so you can search by meaning."
            actions={<Button onClick={() => setUploadOpen(true)}>Upload footage</Button>}
          />
        )
      ) : (
        <>
          <div className="result-head">
            <span data-testid="asset-count">
              <b>{plural(list.data.total, 'asset')}</b>
              {hasFilters ? ' match' : ' in your library'}
            </span>
          </div>
          <AssetGrid assets={list.data.items} view={view} onOpen={(id) => drawer.open(id)} />
        </>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onOpenAsset={(id) => drawer.open(id)} />
      <AssetDetailHost />
    </div>
  )
}
