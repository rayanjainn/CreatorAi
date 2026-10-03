'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, getJson, postJson, unwrap } from './client'
import { ApiError, isCode } from './errors'
import { handleApiError } from './error-toasts'
import { applyMove } from '@/lib/board'
import { toast } from '@/stores/toasts'
import type {
  Activity,
  Board,
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
