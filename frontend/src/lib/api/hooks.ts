'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, getJson, postJson, putRaw, unwrap } from './client'
import { ApiError, isCode } from './errors'
import { handleApiError } from './error-toasts'
import { applyMove } from '@/lib/board'
import { toast } from '@/stores/toasts'
import { trackJob } from '@/lib/track-job'
import type {
  InsightsReport,
  ResearchBrief,
  TwinApplied,
  TwinMessage,
  TwinOverview,
  Activity,
  Asset,
  AssetDetail,
  AssetKind,
  AssetPatch,
  AssetStatus,
  Board,
  Clip,
  ClipStatus,
  GenerateScriptRequest,
  HooksOut,
  LumiclipProject,
  LumiclipStart,
  Comment,
  Invite,
  InvitePreview,
  Member,
  Presence,
  ProjectMember,
  Workspace,
  Match,
  Plan,
  PlanRequest,
  PlanVersion,
  Render,
  RenderPreset,
  CaptionStyle,
  Review,
  ReviewVersion,
  SceneRewrite,
  Script,
  ScriptMeta,
  ScriptPatch,
  ScriptVersion,
  SearchOut,
  Transcript,
  ContentCreate,
  ContentPatch,
  DeleteOut,
  Health,
  Idea,
  IdeasGenerateOut,
  Job,
  LlmStatus,
  LlmTest,
  Me,
  OnboardingRequest,
  Page,
  ProfileUpdate,
  Stage,
} from './types'

/* ----------------------------------------------------------------------------------------------
 * Query keys. Keep them here so invalidation stays greppable.
 * -------------------------------------------------------------------------------------------- */
export const qk = {
  me: ['me'] as const,
  health: ['health'] as const,
  llmStatus: ['llm', 'status'] as const,
  workspace: ['team', 'workspace'] as const,
  members: ['team', 'members'] as const,
  invites: ['team', 'invites'] as const,
  projectMembers: (id: string) => ['team', 'project-members', id] as const,
  comments: (id: string, clipId?: string | null) => ['comments', id, clipId ?? 'all'] as const,
  commentsAll: ['comments'] as const,
  lumiclipStatus: ['lumiclip', 'status'] as const,
  lumiclipProjects: ['lumiclip', 'projects'] as const,
  lumiclipProject: (id: string) => ['lumiclip', 'project', id] as const,
  board: (f?: { q?: string; domain?: string }) => ['board', f ?? {}] as const,
  boardAll: ['board'] as const,
  content: (f?: object) => ['content', 'list', f ?? {}] as const,
  contentAll: ['content'] as const,
  contentItem: (id: string) => ['content', 'item', id] as const,
  ideas: (status: string) => ['ideas', status] as const,
  ideasAll: ['ideas'] as const,
  jobs: (f?: object) => ['jobs', f ?? {}] as const,
  jobsAll: ['jobs'] as const,
  activity: (f?: object) => ['activity', f ?? {}] as const,
  assets: (f?: object) => ['assets', 'list', f ?? {}] as const,
  assetsAll: ['assets'] as const,
  asset: (id: string) => ['assets', 'item', id] as const,
  transcript: (id: string) => ['assets', 'transcript', id] as const,
  search: (q: string, f?: object) => ['search', q, f ?? {}] as const,
  plan: (id: string, version?: number) => ['director', id, 'plan', version ?? 'latest'] as const,
  planVersions: (id: string) => ['director', id, 'plan-versions'] as const,
  review: (id: string, version?: number) => ['director', id, 'review', version ?? 'latest'] as const,
  reviewVersions: (id: string) => ['director', id, 'review-versions'] as const,
  directorAll: (id: string) => ['director', id] as const,
  script: (id: string) => ['scripts', id, 'current'] as const,
  scriptVersions: (id: string) => ['scripts', id, 'versions'] as const,
  scriptsAll: (id: string) => ['scripts', id] as const,
  match: (id: string) => ['match', id] as const,
  clips: (id: string, f?: object) => ['clips', 'item', id, f ?? {}] as const,
  clipsAll: ['clips'] as const,
  clip: (id: string) => ['clips', 'one', id] as const,
  clipRenders: (id: string) => ['renders', 'clip', id] as const,
  revisions: (id: string) => ['edit', id, 'revisions'] as const,
  edit: (id: string) => ['edit', id, 'payload'] as const,
  allClips: (f?: object) => ['clips', 'all', f ?? {}] as const,
  renders: (id: string) => ['renders', 'item', id] as const,
  rendersAll: ['renders'] as const,
  allRenders: (f?: object) => ['renders', 'all', f ?? {}] as const,
}

/* ---------------------------------------------------------------------------------------------- */
/* Session, health, LLM                                                                            */
/* ---------------------------------------------------------------------------------------------- */

export function useMe(enabled = true) {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => unwrap<Me>(api.GET('/api/v1/me'), { skipAuthRedirect: false }),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProfileUpdate) => unwrap(api.PUT('/api/v1/profile', { body })),
    onSuccess: (profile) => {
      qc.setQueryData<Me>(qk.me, (me) => (me ? { ...me, profile } : me))
    },
  })
}

export function useOnboarding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: OnboardingRequest) => unwrap(api.POST('/api/v1/onboarding', { body })),
    onSuccess: (out) => {
      qc.setQueryData<Me>(qk.me, (me) => (me ? { ...me, profile: out.profile } : me))
    },
  })
}

/** Unauthenticated; drives the DataModeBanner and the settings status cards. */
export function useHealth(opts: { refetchMs?: number } = {}) {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => getJson<Health>('/api/v1/health', { auth: false }),
    refetchInterval: opts.refetchMs ?? 60_000,
    staleTime: 15_000,
    retry: 1,
  })
}

export function useLlmStatus() {
  return useQuery({
    queryKey: qk.llmStatus,
    queryFn: () => getJson<LlmStatus>('/api/v1/llm/status'),
    staleTime: 15_000,
  })
}

export function useLlmTest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJson<LlmTest>('/api/v1/llm/test'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.llmStatus })
    },
    meta: { silentCodes: [] },
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Content board                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export function useBoard(filters: { q?: string; domain?: string } = {}) {
  const query = {
    q: filters.q || undefined,
    domain: (filters.domain || undefined) as 'education' | undefined,
  }
  return useQuery({
    queryKey: qk.board(filters),
    queryFn: () => unwrap(api.GET('/api/v1/content/board', { params: { query } })) as Promise<Board>,
    placeholderData: keepPreviousData,
  })
}

export function useContentItem(id: string | undefined) {
  return useQuery({
    queryKey: qk.contentItem(id ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/content/{item_id}', { params: { path: { item_id: id! } } })),
    enabled: !!id,
    // The card reports running jobs: follow them so the header strip and tabs stay live.
    refetchInterval: (q) => ((q.state.data as { running_jobs?: { active?: boolean } } | undefined)?.running_jobs?.active ? 3000 : false),
  })
}

export function useCreateContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ContentCreate) => unwrap(api.POST('/api/v1/content', { body })),
    onSuccess: (card) => {
      void qc.invalidateQueries({ queryKey: qk.boardAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
      void qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success('Added to your board', card.title)
    },
  })
}

export function usePatchContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: ContentPatch }) =>
      unwrap(api.PATCH('/api/v1/content/{item_id}', { params: { path: { item_id: v.id } }, body: v.patch })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.boardAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
    },
  })
}

type MoveVars = { id: string; stage: Stage; position?: number }

/** Drag & drop / move menu: optimistic update with rollback; the server renumbers positions. */
export function useMoveContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: MoveVars) =>
      unwrap(
        api.POST('/api/v1/content/{item_id}/move', {
          params: { path: { item_id: v.id } },
          body: { stage: v.stage, position: v.position ?? null },
        }),
      ),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.boardAll })
      const snapshots = qc.getQueriesData<Board>({ queryKey: qk.boardAll })
      for (const [key, data] of snapshots) {
        if (data) qc.setQueryData<Board>(key, applyMove(data, v.id, v.stage, v.position))
      }
      return { snapshots }
    },
    onError: (err, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data))
      if (isCode(err, 'NO_SCRIPT')) {
        toast.warning('Write a script first', 'Moving to Shoot needs a script with scenes. Generate one in the project, then try again.')
      } else {
        handleApiError(err)
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.boardAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    },
    meta: { silent: true },
  })
}

export type CascadePreview = { scripts?: number; director_outputs?: number; clips?: number; assets_detached?: number }

/** Step 1 of the delete flow: ask the API what a delete would remove (409 CONFIRMATION_REQUIRED). */
export async function previewDelete(id: string): Promise<CascadePreview> {
  try {
    await unwrap(api.DELETE('/api/v1/content/{item_id}', { params: { path: { item_id: id }, query: { confirm: false } } }))
    return {}
  } catch (e) {
    if (e instanceof ApiError && e.code === 'CONFIRMATION_REQUIRED') {
      return (e.details.cascade ?? {}) as CascadePreview
    }
    throw e
  }
}

/** Step 2: delete for real (`confirm=true`). */
export function useDeleteContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<DeleteOut>(
        api.DELETE('/api/v1/content/{item_id}', { params: { path: { item_id: id }, query: { confirm: true } } }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.boardAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
      void qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success('Deleted', 'Footage assets were kept and unlinked.')
    },
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Ideas                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export function useIdeas(status: 'suggested' | 'accepted' | 'dismissed' = 'suggested') {
  return useQuery({
    queryKey: qk.ideas(status),
    queryFn: () =>
      unwrap(api.GET('/api/v1/ideas', { params: { query: { status, limit: 30 } } })) as Promise<Page<Idea>>,
  })
}

export function useGenerateIdeas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { topic?: string; count?: number }) =>
      unwrap<IdeasGenerateOut>(
        api.POST('/api/v1/ideas/generate', { body: { topic: v.topic || null, count: v.count ?? 5 } }),
      ),
    onSuccess: (out) => {
      void qc.invalidateQueries({ queryKey: qk.ideasAll })
      void qc.invalidateQueries({ queryKey: ['activity'] })
      const n = out.ideas.length
      toast.success(
        n ? `${n} new idea${n === 1 ? '' : 's'}` : 'No new ideas',
        out.skipped_duplicates ? `${out.skipped_duplicates} duplicate(s) skipped.` : undefined,
      )
    },
  })
}

export function useAcceptIdea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/ideas/{idea_id}/accept', { params: { path: { idea_id: id } } })),
    onSuccess: (out) => {
      void qc.invalidateQueries({ queryKey: qk.ideasAll })
      void qc.invalidateQueries({ queryKey: qk.boardAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
      toast.success('Added to the Idea column', out.content_item.title)
    },
  })
}

export function useDismissIdea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/ideas/{idea_id}/dismiss', { params: { path: { idea_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.ideasAll }),
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Jobs & activity                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

export function useJobs(filters: { status?: string; entity_type?: string; entity_id?: string; limit?: number } = {}, refetchMs?: number | false) {
  return useQuery({
    queryKey: qk.jobs(filters),
    queryFn: () =>
      unwrap<Job[]>(
        api.GET('/api/v1/jobs', {
          params: { query: { ...filters, limit: filters.limit ?? 50 } },
        }),
      ),
    refetchInterval: refetchMs === undefined ? false : refetchMs,
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/jobs/{job_id}/cancel', { params: { path: { job_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobsAll }),
  })
}

export function useRetryJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/jobs/{job_id}/retry', { params: { path: { job_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobsAll }),
  })
}

export function useActivity(filters: { action?: string; entity_type?: string; entity_id?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: qk.activity(filters),
    queryFn: () =>
      unwrap(api.GET('/api/v1/activity', { params: { query: { ...filters, limit: filters.limit ?? 30 } } })) as Promise<Page<Activity>>,
  })
}

/** Invalidate everything that a finished job could have changed (not session/health). */
export function invalidateAfterJob(qc: QueryClient) {
  void qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'health' && q.queryKey[0] !== 'llm',
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** Resolve to `null` instead of throwing for "nothing there yet" codes (NO_SCRIPT, NO_PLAN, 404). */
async function orNull<T>(p: Promise<T>, ...codes: string[]): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    if (isCode(e, ...codes)) return null
    throw e
  }
}

/** Mutations whose LLM errors are rendered inline by the component (not toasted). */
export const LLM_INLINE = { silentCodes: ['LLM_NOT_CONFIGURED', 'LLM_BUSY'] } as const

const ACTIVE_ASSET = new Set<string>(['uploaded', 'processing'])
export const isAssetActive = (status: string) => ACTIVE_ASSET.has(status)

/** Every content item (for pickers and the cross-project hubs). The API caps `limit` at 200. */
export function useContentList(filters: { stage?: string; q?: string } = {}) {
  return useQuery({
    queryKey: qk.content({ ...filters, all: true }),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/content', { params: { query: { limit: 200, stage: filters.stage as Stage | undefined, q: filters.q || undefined } } }),
      ) as Promise<Page<import('./types').ContentItem>>,
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Library: assets and search                                                                      */
/* ---------------------------------------------------------------------------------------------- */

export type AssetFilters = {
  kind?: AssetKind
  status?: AssetStatus
  tag?: string
  content_item_id?: string
  q?: string
  sort?: string
  limit?: number
  offset?: number
}

/** Paged asset list. While anything is uploading/processing it refreshes every 3 s (job SSE covers the rest). */
export function useAssets(filters: AssetFilters = {}, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.assets(filters),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/assets', {
          params: {
            query: {
              kind: filters.kind,
              status: filters.status,
              tag: filters.tag || undefined,
              content_item_id: filters.content_item_id,
              q: filters.q || undefined,
              sort: (filters.sort ?? '-created_at') as '-created_at',
              limit: filters.limit ?? 60,
              offset: filters.offset ?? 0,
            },
          },
        }),
      ) as Promise<Page<Asset>>,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    refetchInterval: (q) => (q.state.data?.items.some((a) => isAssetActive(a.status)) ? 3000 : false),
  })
}

export function useAsset(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.asset(id ?? ''),
    queryFn: () =>
      unwrap(api.GET('/api/v1/assets/{asset_id}', { params: { path: { asset_id: id! }, query: { include_energy: true } } })) as Promise<AssetDetail>,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && isAssetActive(q.state.data.status) ? 2500 : false),
  })
}

/** Transcript of a ready asset; `null` while it does not exist yet (404). */
export function useTranscript(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.transcript(id ?? ''),
    queryFn: () =>
      orNull(unwrap(api.GET('/api/v1/assets/{asset_id}/transcript', { params: { path: { asset_id: id! } } })) as Promise<Transcript>, 'NOT_FOUND'),
    enabled: !!id && enabled,
  })
}

export function usePatchAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: AssetPatch }) =>
      unwrap(api.PATCH('/api/v1/assets/{asset_id}', { params: { path: { asset_id: v.id } }, body: v.patch })) as Promise<Asset>,
    onSuccess: (_a, v) => {
      void qc.invalidateQueries({ queryKey: qk.assetsAll })
      void qc.invalidateQueries({ queryKey: qk.asset(v.id) })
    },
  })
}

export function useDeleteAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { response, error } = await api.DELETE('/api/v1/assets/{asset_id}', { params: { path: { asset_id: id } } })
      if (!response.ok) await unwrap(Promise.resolve({ error, response }))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.assetsAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
      void qc.invalidateQueries({ queryKey: qk.boardAll })
      toast.success('Asset deleted', 'The file and everything derived from it were removed.')
    },
  })
}

/** Resume (no stage) or restart (`stage`) the processing pipeline. */
export function useReprocessAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; stage?: string }) =>
      unwrap(api.POST('/api/v1/assets/{asset_id}/reprocess', { params: { path: { asset_id: v.id } }, body: { stage: v.stage ?? null } })),
    onSuccess: (out, v) => {
      void trackJob(out.job_id)
      void qc.invalidateQueries({ queryKey: qk.assetsAll })
      void qc.invalidateQueries({ queryKey: qk.asset(v.id) })
    },
  })
}

/** Attach an SRT / VTT / words.json transcript; the pipeline re-runs from transcription. */
export function useAttachTranscript() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; file: File }) => {
      const name = v.file.name.toLowerCase()
      const format = name.endsWith('.srt') ? 'srt' : name.endsWith('.vtt') ? 'vtt' : 'words.json'
      return putRaw<{ job_id: string | null; asset: Asset }>(`/api/v1/assets/${encodeURIComponent(v.id)}/transcript?format=${format}`, v.file, 'text/plain')
    },
    onSuccess: (out, v) => {
      void trackJob(out.job_id)
      void qc.invalidateQueries({ queryKey: qk.assetsAll })
      void qc.invalidateQueries({ queryKey: qk.asset(v.id) })
      void qc.invalidateQueries({ queryKey: qk.transcript(v.id) })
      toast.success('Transcript attached', 'Processing continues from transcription.')
    },
  })
}

export type SearchFilters = { kind?: 'speech' | 'visual'; asset_kind?: 'video' | 'audio' | 'image'; content_item_id?: string; limit?: number }

/** Hybrid (vector + keyword) search over transcripts and keyframe captions. */
export function useSearch(q: string, filters: SearchFilters = {}) {
  const term = q.trim()
  return useQuery({
    queryKey: qk.search(term, filters),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/search', {
          params: { query: { q: term, limit: filters.limit ?? 30, kind: filters.kind, asset_kind: filters.asset_kind, content_item_id: filters.content_item_id } },
        }),
      ) as Promise<SearchOut>,
    enabled: term.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* AI Director                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/** `enabled` lets callers skip the request (and its 409 in the console) when the card says there is no plan. */
export function usePlan(id: string, version?: number, enabled = true) {
  return useQuery({
    enabled,
    queryKey: qk.plan(id, version),
    queryFn: () =>
      orNull(
        unwrap(api.GET('/api/v1/content/{item_id}/director/plan', { params: { path: { item_id: id }, query: { version } } })) as unknown as Promise<Plan>,
        'NO_PLAN',
      ),
  })
}

export function usePlanVersions(id: string) {
  return useQuery({
    queryKey: qk.planVersions(id),
    queryFn: () => unwrap(api.GET('/api/v1/content/{item_id}/director/plan/versions', { params: { path: { item_id: id } } })) as Promise<PlanVersion[]>,
  })
}

export function useGeneratePlan(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PlanRequest) => unwrap(api.POST('/api/v1/content/{item_id}/director/plan', { params: { path: { item_id: id } }, body })) as unknown as Promise<Plan>,
    onSuccess: (plan) => {
      qc.setQueryData(qk.plan(id), plan)
      void qc.invalidateQueries({ queryKey: qk.directorAll(id) })
      void qc.invalidateQueries({ queryKey: qk.contentItem(id) })
      void qc.invalidateQueries({ queryKey: qk.boardAll })
    },
    meta: LLM_INLINE,
  })
}

export function usePatchPlan(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (shot_list: import('./types').ShotEntry[]) =>
      unwrap(api.PATCH('/api/v1/content/{item_id}/director/plan', { params: { path: { item_id: id } }, body: { shot_list } })) as unknown as Promise<Plan>,
    onSuccess: (plan) => {
      qc.setQueryData(qk.plan(id), plan)
      void qc.invalidateQueries({ queryKey: qk.directorAll(id) })
    },
  })
}

export function useReview(id: string, version?: number, enabled = true) {
  return useQuery({
    enabled,
    queryKey: qk.review(id, version),
    queryFn: () =>
      orNull(unwrap(api.GET('/api/v1/content/{item_id}/director/review', { params: { path: { item_id: id }, query: { version } } })) as unknown as Promise<Review>, 'NOT_FOUND', 'NO_REVIEW'),
  })
}

export function useReviewVersions(id: string) {
  return useQuery({
    queryKey: qk.reviewVersions(id),
    queryFn: () => unwrap(api.GET('/api/v1/content/{item_id}/director/review/versions', { params: { path: { item_id: id } } })) as Promise<ReviewVersion[]>,
  })
}

export function useRunReview(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/content/{item_id}/director/review', { params: { path: { item_id: id } } })) as unknown as Promise<Review>,
    onSuccess: (review) => {
      qc.setQueryData(qk.review(id), review)
      void qc.invalidateQueries({ queryKey: qk.directorAll(id) })
      void qc.invalidateQueries({ queryKey: qk.contentItem(id) })
    },
    meta: { silentCodes: ['LLM_NOT_CONFIGURED', 'LLM_BUSY', 'ASSET_NOT_READY'] },
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Scripts                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** Current script of the item; `null` when it has none (409 NO_SCRIPT). */
export function useScript(id: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: qk.script(id),
    queryFn: () => orNull(unwrap(api.GET('/api/v1/content/{item_id}/script', { params: { path: { item_id: id } } })) as unknown as Promise<Script>, 'NO_SCRIPT'),
  })
}

export function useScriptVersions(id: string) {
  return useQuery({
    enabled: !!id,
    queryKey: qk.scriptVersions(id),
    queryFn: () => unwrap(api.GET('/api/v1/content/{item_id}/scripts', { params: { path: { item_id: id } } })) as Promise<ScriptVersion[]>,
  })
}

function invalidateScripts(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: qk.scriptsAll(id) })
  void qc.invalidateQueries({ queryKey: qk.contentItem(id) })
  void qc.invalidateQueries({ queryKey: qk.boardAll })
  void qc.invalidateQueries({ queryKey: qk.match(id) })
}

export function useGenerateHooks(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { count?: number; tone?: string | null; platform?: string | null }) =>
      unwrap(api.POST('/api/v1/content/{item_id}/hooks', { params: { path: { item_id: id } }, body })) as unknown as Promise<HooksOut>,
    onSuccess: () => invalidateScripts(qc, id),
    meta: LLM_INLINE,
  })
}

export function useGenerateScript(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GenerateScriptRequest) =>
      unwrap(api.POST('/api/v1/content/{item_id}/script/generate', { params: { path: { item_id: id } }, body })) as unknown as Promise<Script>,
    onSuccess: (script) => {
      qc.setQueryData(qk.script(id), script)
      invalidateScripts(qc, id)
    },
    meta: LLM_INLINE,
  })
}

/** Save user edits. The response is the full script, so the cache is replaced without a refetch. */
export function usePatchScript(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { scriptId: string; patch: ScriptPatch }) =>
      unwrap(api.PATCH('/api/v1/scripts/{script_id}', { params: { path: { script_id: v.scriptId } }, body: v.patch as never })) as unknown as Promise<Script>,
    onSuccess: (script) => {
      qc.setQueryData<Script | null>(qk.script(id), (cur) => (cur && cur.id === script.id ? script : cur))
      void qc.invalidateQueries({ queryKey: qk.scriptVersions(id) })
      void qc.invalidateQueries({ queryKey: qk.match(id) })
    },
  })
}

export function useRestoreScript(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scriptId: string) => unwrap(api.POST('/api/v1/scripts/{script_id}/restore', { params: { path: { script_id: scriptId } } })) as unknown as Promise<Script>,
    onSuccess: () => {
      invalidateScripts(qc, id)
      toast.success('Version restored', 'It is now the current script. History is kept.')
    },
  })
}

export function useApproveScript(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scriptId: string) => unwrap(api.POST('/api/v1/scripts/{script_id}/approve', { params: { path: { script_id: scriptId } } })) as unknown as Promise<Script>,
    onSuccess: () => {
      invalidateScripts(qc, id)
      void qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

export function useRewriteScene(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { scriptId: string; idx: number; mode: 'regenerate' | 'tighten'; instruction?: string; ratio?: number }) =>
      v.mode === 'regenerate'
        ? (unwrap(
            api.POST('/api/v1/scripts/{script_id}/scenes/{idx}/regenerate', {
              params: { path: { script_id: v.scriptId, idx: v.idx } },
              body: { instruction: v.instruction ?? '' },
            }),
          ) as unknown as Promise<SceneRewrite>)
        : (unwrap(
            api.POST('/api/v1/scripts/{script_id}/scenes/{idx}/tighten', {
              params: { path: { script_id: v.scriptId, idx: v.idx } },
              body: { target_ratio: v.ratio ?? 0.75 },
            }),
          ) as unknown as Promise<SceneRewrite>),
    onSuccess: (out) => {
      qc.setQueryData(qk.script(id), out.script)
      invalidateScripts(qc, id)
    },
    meta: LLM_INLINE,
  })
}

export function useGenerateMeta(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scriptId: string) =>
      unwrap(api.POST('/api/v1/scripts/{script_id}/meta', { params: { path: { script_id: scriptId } } })) as unknown as Promise<{ script_id: string; meta: ScriptMeta; provenance: import('./types').Provenance }>,
    onSuccess: () => invalidateScripts(qc, id),
    meta: { silentCodes: ['LLM_NOT_CONFIGURED', 'LLM_BUSY', 'NO_SCRIPT'] },
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Matching                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** Match state of the current script. `refetchMs` follows a running job. */
export function useMatch(id: string, opts: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: qk.match(id),
    queryFn: () => orNull(unwrap(api.GET('/api/v1/content/{item_id}/match', { params: { path: { item_id: id } } })) as unknown as Promise<Match>, 'NO_SCRIPT'),
    refetchInterval: (q) => {
      const st = q.state.data?.job?.status
      return opts.poll || st === 'queued' || st === 'running' ? 2500 : false
    },
  })
}

export function useRunMatch(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/content/{item_id}/match', { params: { path: { item_id: id } } })),
    onSuccess: (out) => {
      void trackJob(out.job_id)
      void qc.invalidateQueries({ queryKey: qk.match(id) })
      void qc.invalidateQueries({ queryKey: qk.contentItem(id) })
    },
    meta: { silentCodes: ['NO_SCRIPT', 'ASSET_NOT_READY'] },
  })
}

export function useBeatDecision(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { matchId: string; action: 'confirm' | 'reject' | 'swap'; alternative_index?: number }) => {
      const path = { match_id: v.matchId }
      if (v.action === 'swap') return unwrap(api.POST('/api/v1/beat-matches/{match_id}/swap', { params: { path }, body: { alternative_index: v.alternative_index } }))
      if (v.action === 'confirm') return unwrap(api.POST('/api/v1/beat-matches/{match_id}/confirm', { params: { path } }))
      return unwrap(api.POST('/api/v1/beat-matches/{match_id}/reject', { params: { path } }))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.match(id) })
      void qc.invalidateQueries({ queryKey: qk.contentItem(id) })
    },
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Clips and renders                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export function useClips(id: string, filters: { status?: ClipStatus; kind?: 'short' | 'full' } = {}) {
  return useQuery({
    queryKey: qk.clips(id, filters),
    queryFn: () => unwrap(api.GET('/api/v1/content/{item_id}/clips', { params: { path: { item_id: id }, query: filters } })) as Promise<Clip[]>,
  })
}

/** One clip (the editor header and Export dialog). */
export function useClip(id: string | undefined) {
  return useQuery({
    queryKey: qk.clip(id ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/clips/{clip_id}', { params: { path: { clip_id: id! } } })) as Promise<Clip>,
    enabled: !!id,
    retry: false,
  })
}

/** Renders of one clip, newest first (the editor's stale-render hint). */
export function useClipRenders(id: string | undefined) {
  return useQuery({
    queryKey: qk.clipRenders(id ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/clips/{clip_id}/renders', { params: { path: { clip_id: id! } } })) as Promise<Render[]>,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued' || r.status === 'rendering') ? 3000 : false),
  })
}

/** Clips of every project (Smart Clips hub). */
export function useAllClips(filters: { status?: ClipStatus; kind?: 'short' | 'full'; content_item_id?: string } = {}) {
  return useQuery({
    queryKey: qk.allClips(filters),
    queryFn: () => unwrap(api.GET('/api/v1/clips', { params: { query: { ...filters, limit: 200 } } })) as Promise<Clip[]>,
  })
}

export function useGenerateClips(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { asset_id?: string | null; count?: number; include_full_cut?: boolean }) =>
      unwrap(api.POST('/api/v1/content/{item_id}/clips/generate', { params: { path: { item_id: id } }, body })),
    onSuccess: (out) => {
      void trackJob(out.job_id)
      void qc.invalidateQueries({ queryKey: qk.jobsAll })
    },
    meta: { silentCodes: ['ASSET_NOT_READY'] },
  })
}

export function usePatchClip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: { title?: string; hook?: string; caption?: string } }) =>
      unwrap(api.PATCH('/api/v1/clips/{clip_id}', { params: { path: { clip_id: v.id } }, body: v.patch })) as Promise<Clip>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.clipsAll }),
  })
}

export function useClipDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; action: 'accept' | 'reject' }) =>
      unwrap(
        v.action === 'accept'
          ? api.POST('/api/v1/clips/{clip_id}/accept', { params: { path: { clip_id: v.id } } })
          : api.POST('/api/v1/clips/{clip_id}/reject', { params: { path: { clip_id: v.id } } }),
      ) as Promise<Clip>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.clipsAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
      void qc.invalidateQueries({ queryKey: qk.boardAll })
    },
  })
}

export function useContentRenders(id: string) {
  return useQuery({
    queryKey: qk.renders(id),
    queryFn: () => unwrap(api.GET('/api/v1/content/{item_id}/renders', { params: { path: { item_id: id } } })) as Promise<Render[]>,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued' || r.status === 'rendering') ? 3000 : false),
  })
}

/** Renders of every project (Repurpose hub). */
export function useAllRenders(filters: { status?: Render['status'] } = {}) {
  return useQuery({
    queryKey: qk.allRenders(filters),
    queryFn: () => unwrap(api.GET('/api/v1/renders', { params: { query: { ...filters, limit: 200 } } })) as Promise<Render[]>,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued' || r.status === 'rendering') ? 3000 : false),
  })
}

/** Poll one render until it settles (RenderDialog). */
export function useRender(id: string | null | undefined) {
  return useQuery({
    queryKey: ['renders', 'one', id ?? ''] as const,
    queryFn: () => unwrap(api.GET('/api/v1/renders/{render_id}', { params: { path: { render_id: id! } } })) as Promise<Render>,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'queued' || q.state.data.status === 'rendering') ? 1500 : false),
  })
}

export function useCreateRender() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { clipId: string; preset: RenderPreset; caption_style?: CaptionStyle | null }) =>
      unwrap(api.POST('/api/v1/clips/{clip_id}/renders', { params: { path: { clip_id: v.clipId } }, body: { preset: v.preset, caption_style: v.caption_style ?? null } })),
    onSuccess: (out) => {
      void trackJob(out.job_id)
      void qc.invalidateQueries({ queryKey: qk.rendersAll })
    },
    meta: { silentCodes: ['DURATION_EXCEEDS_PRESET', 'ASSET_NOT_READY'] },
  })
}

export function useDeleteRender() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { response, error } = await api.DELETE('/api/v1/renders/{render_id}', { params: { path: { render_id: id } } })
      if (!response.ok) await unwrap(Promise.resolve({ error, response }))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.rendersAll })
      toast.success('Render deleted')
    },
  })
}

/** One job, polled until it settles (generate-clips panel: result warnings). */
export function useJob(id: string | null | undefined) {
  return useQuery({
    queryKey: ['jobs', 'one', id ?? ''] as const,
    queryFn: () => unwrap<Job>(api.GET('/api/v1/jobs/{job_id}', { params: { path: { job_id: id! } } })),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 1500 : false),
  })
}

/* Fetchers shared with the cross-project hubs (useQueries), so they hit the same cache entries as the hooks above. */
export const fetchPlan = (id: string) =>
  orNull(unwrap(api.GET('/api/v1/content/{item_id}/director/plan', { params: { path: { item_id: id }, query: {} } })) as unknown as Promise<Plan>, 'NO_PLAN')
export const fetchReview = (id: string) =>
  orNull(unwrap(api.GET('/api/v1/content/{item_id}/director/review', { params: { path: { item_id: id }, query: {} } })) as unknown as Promise<Review>, 'NOT_FOUND', 'NO_REVIEW')
export const fetchMatch = (id: string) =>
  orNull(unwrap(api.GET('/api/v1/content/{item_id}/match', { params: { path: { item_id: id } } })) as unknown as Promise<Match>, 'NO_SCRIPT')

/* ---------- LumiClip cloud clipper (optional) ---------- */
const lumiclipRunning = (p?: LumiclipProject) => !!p && !['completed', 'failed'].includes(p.status)

export function useLumiclipStatus() {
  return useQuery({
    queryKey: qk.lumiclipStatus,
    queryFn: () => unwrap(api.GET('/api/v1/lumiclip/status')),
    staleTime: 60_000,
  })
}

export function useLumiclipProjects() {
  return useQuery({
    queryKey: qk.lumiclipProjects,
    queryFn: () => unwrap(api.GET('/api/v1/lumiclip/projects', { params: { query: { limit: 30 } } })) as Promise<LumiclipProject[]>,
    refetchInterval: (q) => (q.state.data?.some(lumiclipRunning) ? 6000 : false),
  })
}

/** One project; asks the server (which asks LumiClip) for fresh progress every few seconds while it runs. */
export function useLumiclipProject(id: string | null | undefined) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: qk.lumiclipProject(id ?? ''),
    queryFn: async () => {
      const p = (await unwrap(api.GET('/api/v1/lumiclip/projects/{project_id}', { params: { path: { project_id: id! } } }))) as LumiclipProject
      // keep the "Recent" list in step with what the detail view just learned
      qc.setQueryData<LumiclipProject[]>(qk.lumiclipProjects, (old) => old?.map((x) => (x.id === p.id ? p : x)))
      return p
    },
    enabled: !!id,
    refetchInterval: (q) => (lumiclipRunning(q.state.data) ? 4000 : false),
  })
}

export function useStartLumiclip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LumiclipStart) => unwrap(api.POST('/api/v1/lumiclip/projects', { body })) as Promise<LumiclipProject>,
    onSuccess: (p) => {
      qc.setQueryData(qk.lumiclipProject(p.id), p)
      void qc.invalidateQueries({ queryKey: qk.lumiclipProjects })
    },
    meta: { silentCodes: ['LUMICLIP_NOT_CONFIGURED', 'CLOUDINARY_NOT_CONFIGURED'] },
  })
}

export function useImportLumiclipClip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { projectId: string; clipId: string; mode?: 'full' | 'light'; contentItemId?: string | null }) =>
      unwrap(
        api.POST('/api/v1/lumiclip/projects/{project_id}/clips/{clip_id}/import', {
          params: { path: { project_id: v.projectId, clip_id: v.clipId } },
          body: { mode: v.mode ?? 'light', content_item_id: v.contentItemId ?? null },
        }),
      ),
    onSuccess: (out, v) => {
      void trackJob(out.job_id)
      qc.setQueryData(qk.lumiclipProject(v.projectId), out.project)
      void qc.invalidateQueries({ queryKey: ['assets'] })
      void qc.invalidateQueries({ queryKey: qk.lumiclipProjects })
    },
  })
}

export function useExportLumiclipClip() {
  return useMutation({
    mutationFn: (v: { projectId: string; clipId: string; quality: '720p' | '1080p' }) =>
      unwrap(
        api.POST('/api/v1/lumiclip/projects/{project_id}/clips/{clip_id}/export', {
          params: { path: { project_id: v.projectId, clip_id: v.clipId } },
          body: { quality: v.quality },
        }),
      ) as Promise<{ status?: string; url?: string | null; estimated_seconds?: number | null }>,
  })
}

export function useDeleteLumiclipProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/lumiclip/projects/{project_id}', { params: { path: { project_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.lumiclipProjects }),
  })
}

/* ---------- team: workspace, members, invites, project roles ---------- */
export function useWorkspaceInfo() {
  return useQuery({ queryKey: qk.workspace, queryFn: () => unwrap(api.GET('/api/v1/workspace')) as Promise<Workspace> })
}

export function useMembers() {
  return useQuery({ queryKey: qk.members, queryFn: () => unwrap(api.GET('/api/v1/workspace/members')) as Promise<Member[]> })
}

export function useInvites(enabled: boolean) {
  return useQuery({ queryKey: qk.invites, queryFn: () => unwrap(api.GET('/api/v1/workspace/invites')) as Promise<Invite[]>, enabled })
}

export function useRenameWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => unwrap(api.PATCH('/api/v1/workspace', { body: { name } })) as Promise<Workspace>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspace })
      void qc.invalidateQueries({ queryKey: qk.me })
    },
  })
}

export function useChangeMemberRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; role: Member['role'] }) =>
      unwrap(api.PATCH('/api/v1/workspace/members/{user_id}', { params: { path: { user_id: v.userId } }, body: { role: v.role } })) as Promise<Member>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team'] }),
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => unwrap(api.DELETE('/api/v1/workspace/members/{user_id}', { params: { path: { user_id: userId } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team'] }),
  })
}

export function useCreateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; role: 'viewer' | 'editor' | 'admin'; content_item_id?: string | null; project_role?: 'viewer' | 'editor' | null }) =>
      unwrap(api.POST('/api/v1/workspace/invites', { body })) as Promise<Invite>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.invites }),
  })
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/workspace/invites/{invite_id}', { params: { path: { invite_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.invites }),
  })
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: ['team', 'invite-preview', token],
    queryFn: () => unwrap(api.GET('/api/v1/invites/{token}', { params: { path: { token } } }), { skipAuthRedirect: true }) as Promise<InvitePreview>,
    retry: false,
  })
}

export function useAcceptInvite() {
  return useMutation({
    mutationFn: (token: string) => unwrap(api.POST('/api/v1/invites/{token}/accept', { params: { path: { token } } })),
    meta: { silent: true },
  })
}

export function useProjectMembers(itemId: string, enabled = true) {
  return useQuery({
    queryKey: qk.projectMembers(itemId),
    queryFn: () => unwrap(api.GET('/api/v1/content/{item_id}/members', { params: { path: { item_id: itemId } } })) as Promise<ProjectMember[]>,
    enabled,
  })
}

export function useSetProjectRole(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; role: 'viewer' | 'editor' | null }) =>
      v.role
        ? unwrap(api.PUT('/api/v1/workspace/projects/{project_item_id}/members/{user_id}', { params: { path: { project_item_id: itemId, user_id: v.userId } }, body: { role: v.role } }))
        : unwrap(api.DELETE('/api/v1/workspace/projects/{project_item_id}/members/{user_id}', { params: { path: { project_item_id: itemId, user_id: v.userId } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projectMembers(itemId) }),
  })
}

/* ---------- comments and presence ---------- */
export function useComments(itemId: string, clipId?: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.comments(itemId, clipId),
    queryFn: () =>
      unwrap(api.GET('/api/v1/content/{item_id}/comments', { params: { path: { item_id: itemId }, query: { clip_id: clipId ?? undefined } } })) as Promise<Comment[]>,
    enabled,
    refetchInterval: 15_000,
  })
}

export function useAddComment(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { body: string; clip_id?: string | null; at_sec?: number | null; parent_id?: string | null }) =>
      unwrap(api.POST('/api/v1/content/{item_id}/comments', { params: { path: { item_id: itemId } }, body })) as Promise<Comment>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.commentsAll }),
  })
}

export function usePatchComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; body?: string; resolved?: boolean }) =>
      unwrap(api.PATCH('/api/v1/comments/{comment_id}', { params: { path: { comment_id: v.id } }, body: { body: v.body, resolved: v.resolved } })) as Promise<Comment>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.commentsAll }),
  })
}

export function useDeleteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/comments/{comment_id}', { params: { path: { comment_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.commentsAll }),
  })
}

/**
 * Tell the server this project is open (every 10 s) and get back who else is here. `where` says what you are looking at,
 * e.g. `script` or `editor:<clip id>`.
 */
export function usePresence(itemId: string | undefined, where: string) {
  return useQuery({
    queryKey: ['presence', itemId, where],
    queryFn: () => unwrap(api.POST('/api/v1/content/{item_id}/presence', { params: { path: { item_id: itemId! } }, body: { where } })) as Promise<Presence[]>,
    enabled: !!itemId,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    meta: { silent: true },
  })
}

/* ---------- creator intelligence ---------- */
export function useInsights(days: number) {
  return useQuery({
    queryKey: ['insights', days],
    queryFn: () => unwrap(api.GET('/api/v1/insights/production', { params: { query: { days } } })) as unknown as Promise<InsightsReport>,
    staleTime: 30_000,
  })
}

/* ---------- digital twin ---------- */
const twinGet = <T,>(path: string) => unwrap(api.GET(path as never, {} as never)) as unknown as Promise<T>
export function useTwin() {
  return useQuery({ queryKey: ['twin'], queryFn: () => twinGet<TwinOverview>('/api/v1/twin') })
}
export function useTwinMessages() {
  return useQuery({ queryKey: ['twin', 'messages'], queryFn: () => twinGet<TwinMessage[]>('/api/v1/twin/messages') })
}
export function useTwinChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { message: string; content_item_id?: string | null; clip_id?: string | null }) =>
      unwrap(api.POST('/api/v1/twin/chat' as never, { body } as never)) as unknown as Promise<TwinMessage>,
    onSettled: () => void qc.invalidateQueries({ queryKey: ['twin', 'messages'] }),
  })
}
export function useTwinApply() {
  return useMutation({
    mutationFn: (v: { id: string; index?: number }) =>
      unwrap(api.POST('/api/v1/twin/messages/{message_id}/apply' as never, { params: { path: { message_id: v.id } }, body: { index: v.index ?? 0 } } as never)) as unknown as Promise<TwinApplied>,
  })
}
export function useTwinStyleUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/twin/style/update' as never, {} as never)) as unknown as Promise<TwinOverview>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['twin'] }),
  })
}
export function useTwinClear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/v1/twin/messages' as never, {} as never)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['twin', 'messages'] }),
  })
}

/* ---------- research agent ---------- */
export function useResearch(itemId: string) {
  return useQuery({
    queryKey: ['research', itemId],
    queryFn: () => unwrap(api.GET('/api/v1/research' as never, { params: { query: { content_item_id: itemId } } } as never)) as unknown as Promise<ResearchBrief[]>,
  })
}
export function useRunResearch(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (topic: string) => unwrap(api.POST('/api/v1/research' as never, { body: { topic, content_item_id: itemId } } as never)) as unknown as Promise<ResearchBrief>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['research', itemId] }),
  })
}
