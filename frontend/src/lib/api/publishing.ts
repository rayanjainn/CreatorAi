import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, postJson } from '@/lib/api/client'
import { trackJob } from '@/lib/track-job'

/** YouTube connection and publishing (backend/app/services/{youtube,publish}_service.py). */
export type YoutubeStatus = {
  configured: boolean
  connected: boolean
  status: string | null
  channel_id: string | null
  channel_title: string | null
  connected_at: string | null
  last_sync_at: string | null
  redirect_uri: string
}

export type PublishRender = {
  id: string
  clip_id: string
  clip_title: string
  clip_kind: string
  preset: string
  duration_sec: number | null
  publishable: boolean
  preview_url: string | null
  thumbnail_url: string | null
  stale: boolean
  created_at: string
  sponsor_brands: string[]
}

export type PublishDefaults = {
  title: string
  title_options: string[]
  description: string
  tags: string[]
  renders: PublishRender[]
  disclosure_template: string
  connection: YoutubeStatus
}

export type PublishJob = {
  id: string
  render_id: string
  title: string
  description: string
  tags: string[]
  visibility: 'private' | 'unlisted' | 'public'
  scheduled_at: string | null
  status: 'queued' | 'uploading' | 'processing' | 'scheduled' | 'published' | 'failed'
  youtube_video_id: string | null
  url: string | null
  studio_url: string | null
  error: string | null
  created_at: string
  published_at: string | null
  job_id?: string
}

export type PublishInput = {
  render_id: string
  title: string
  description: string
  tags: string[]
  visibility: PublishJob['visibility']
  scheduled_at?: string | null
}

const V1 = '/api/v1'
export const pk = {
  youtube: ['youtube', 'status'] as const,
  defaults: (itemId: string) => ['publish', itemId, 'defaults'] as const,
  jobs: (itemId: string) => ['publish', itemId, 'jobs'] as const,
}

export function useYoutubeStatus() {
  return useQuery({ queryKey: pk.youtube, queryFn: () => getJson<YoutubeStatus>(`${V1}/youtube/status`) })
}

export function useConnectYoutube() {
  return useMutation({
    mutationFn: () => postJson<{ url: string }>(`${V1}/youtube/oauth/start`),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
  })
}

export function useDisconnectYoutube() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => deleteJson(`${V1}/youtube/connection`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['youtube'] }),
  })
}

export function useSyncYoutube() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJson<{ job_id: string }>(`${V1}/youtube/sync`),
    onSuccess: (out) => {
      void trackJob(out.job_id)
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['insights'] })
        void qc.invalidateQueries({ queryKey: ['youtube'] })
      }, 2500)
    },
  })
}

export function usePublishDefaults(itemId: string) {
  return useQuery({ queryKey: pk.defaults(itemId), queryFn: () => getJson<PublishDefaults>(`${V1}/content/${encodeURIComponent(itemId)}/publish/defaults`) })
}

export function usePublishJobs(itemId: string) {
  return useQuery({
    queryKey: pk.jobs(itemId),
    queryFn: () => getJson<PublishJob[]>(`${V1}/content/${encodeURIComponent(itemId)}/publish`),
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => j.status === 'queued' || j.status === 'uploading') ? 2000 : false),
  })
}

export function usePublish(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PublishInput) => postJson<PublishJob>(`${V1}/content/${encodeURIComponent(itemId)}/publish`, body),
    onSuccess: (out) => {
      void trackJob(out.job_id)
      void qc.invalidateQueries({ queryKey: pk.jobs(itemId) })
      void qc.invalidateQueries({ queryKey: ['content'] })
    },
  })
}

export function useRetryPublish(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => postJson<PublishJob>(`${V1}/publish/${encodeURIComponent(id)}/retry`),
    onSuccess: (out) => {
      void trackJob(out.job_id)
      void qc.invalidateQueries({ queryKey: pk.jobs(itemId) })
    },
  })
}
