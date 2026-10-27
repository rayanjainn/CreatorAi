import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api/client'
import type { Provenance } from '@/lib/api/types'

/** Brand deals, rate estimate, pitch and lookup (backend/app/services/monetization.py). */
export const DEAL_STAGES = [
  { id: 'prospect', label: 'Prospect' },
  { id: 'pitched', label: 'Pitched' },
  { id: 'negotiating', label: 'Negotiating' },
  { id: 'contracted', label: 'Contracted' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'paid', label: 'Paid' },
  { id: 'lost', label: 'Lost' },
] as const
export type DealStage = (typeof DEAL_STAGES)[number]['id']

export type Pitch = {
  subject: string
  email: string
  talking_points: string[]
  follow_up: string
  provenance: Provenance
  created_at: string
}

export type Deal = {
  id: string
  brand: string
  website: string
  contact_name: string
  contact_email: string
  stage: DealStage
  fee: number | null
  currency: string
  deliverables: string
  due_date: string | null
  notes: string
  content_item_id: string | null
  pitch: Pitch | null
  overdue: boolean
  created_at: string
  updated_at: string
}
export type DealInput = Partial<Omit<Deal, 'id' | 'pitch' | 'overdue' | 'created_at' | 'updated_at'>>

export type DealSummary = {
  currency: string | null
  currencies: string[]
  by_stage: Record<DealStage, { count: number; value: number }>
  open_value: number
  booked_value: number
  paid_value: number
  average_paid_fee: number | null
  win_rate: number | null
  overdue: Deal[]
  upcoming: Deal[]
  total: number
}

export type RateEstimate = {
  avg_views: number
  cpm_low: number
  cpm_high: number
  placements: number
  low: number
  mid: number
  high: number
  formula: string
  default_cpm: boolean
  history: { paid_deals: number; average_fee: number | null; highest_fee: number | null }
  provenance: Provenance
}

export type BrandLookup = {
  site: string
  title: string
  description: string
  emails: { email: string; found_on: string }[]
  socials: Record<string, string>
  pages: { url: string; status: number | null; error?: string }[]
  note: string
}

export type ChannelStats = { subscribers?: string; avg_views?: string; audience?: string; top_countries?: string; engagement?: string }

/* ---------- sponsor briefs and slots (backend/app/services/sponsor_service.py) ---------- */
export type SponsorSlot = {
  id: string
  brief_id: string
  asset_id: string
  at_sec: number
  kind: 'pause' | 'topic_shift' | 'both'
  score: number
  rationale: string
  integration_script: string
  lower_third: string
  transition_back: string
  status: 'suggested' | 'accepted' | 'rejected'
  clip_id: string | null
  provenance: Provenance
}
export type SponsorBrief = {
  id: string
  content_item_id: string
  deal_id: string | null
  brand: string
  product: string
  key_points: string[]
  cta: string
  do_not_say: string[]
  duration_sec: number
  created_at: string
  slots: SponsorSlot[]
}
export type BriefInput = Partial<Pick<SponsorBrief, 'brand' | 'product' | 'key_points' | 'cta' | 'do_not_say' | 'duration_sec' | 'deal_id'>>
export type FindSlotsOut = { brief: SponsorBrief; asset_id: string; slots: SponsorSlot[]; warnings: string[]; provenance: Provenance }

const V1 = '/api/v1'
export const mk = {
  deals: ['monetization', 'deals'] as const,
  summary: ['monetization', 'summary'] as const,
  briefs: (itemId: string) => ['sponsors', itemId] as const,
}

export function useDeals() {
  return useQuery({ queryKey: mk.deals, queryFn: () => getJson<Deal[]>(`${V1}/monetization/deals`) })
}

export function useDealSummary() {
  return useQuery({ queryKey: mk.summary, queryFn: () => getJson<DealSummary>(`${V1}/monetization/summary`) })
}

function useInvalidateDeals() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['monetization'] })
    void qc.invalidateQueries({ queryKey: ['activity'] })
  }
}

export function useSaveDeal() {
  const done = useInvalidateDeals()
  return useMutation({
    mutationFn: ({ id, ...body }: DealInput & { id?: string }) =>
      id ? patchJson<Deal>(`${V1}/monetization/deals/${encodeURIComponent(id)}`, body) : postJson<Deal>(`${V1}/monetization/deals`, body),
    onSuccess: done,
  })
}

export function useDeleteDeal() {
  const done = useInvalidateDeals()
  return useMutation({ mutationFn: (id: string) => deleteJson(`${V1}/monetization/deals/${encodeURIComponent(id)}`), onSuccess: done })
}

export function usePitch() {
  const done = useInvalidateDeals()
  return useMutation({
    mutationFn: ({ id, stats, notes }: { id: string; stats: ChannelStats; notes?: string }) =>
      postJson<Deal>(`${V1}/monetization/deals/${encodeURIComponent(id)}/pitch`, { stats, notes: notes ?? '' }),
    onSuccess: done,
  })
}

export function useRateEstimate() {
  return useMutation({
    mutationFn: (body: { avg_views: number; cpm_low?: number; cpm_high?: number; placements?: number }) =>
      postJson<RateEstimate>(`${V1}/monetization/rate`, body),
  })
}

export function useBrandLookup() {
  return useMutation({ mutationFn: (website: string) => postJson<BrandLookup>(`${V1}/monetization/lookup`, { website }) })
}

export function useSponsorBriefs(itemId: string) {
  return useQuery({ queryKey: mk.briefs(itemId), queryFn: () => getJson<SponsorBrief[]>(`${V1}/content/${encodeURIComponent(itemId)}/sponsors`) })
}

export function useSaveBrief(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: BriefInput & { id?: string }) =>
      id ? patchJson<SponsorBrief>(`${V1}/sponsors/${encodeURIComponent(id)}`, body) : postJson<SponsorBrief>(`${V1}/content/${encodeURIComponent(itemId)}/sponsors`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.briefs(itemId) }),
  })
}

export function useDeleteBrief(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteJson(`${V1}/sponsors/${encodeURIComponent(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.briefs(itemId) }),
  })
}

export function useFindSlots(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ briefId, assetId }: { briefId: string; assetId?: string }) =>
      postJson<FindSlotsOut>(`${V1}/sponsors/${encodeURIComponent(briefId)}/find-slots`, { asset_id: assetId ?? null }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.briefs(itemId) }),
  })
}

export function useUpdateSlot(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; integration_script?: string; lower_third?: string; status?: 'suggested' | 'rejected' }) =>
      patchJson<SponsorSlot>(`${V1}/sponsor-slots/${encodeURIComponent(id)}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.briefs(itemId) }),
  })
}

export function useAcceptSlot(itemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, clipId }: { id: string; clipId: string }) =>
      postJson<{ slot: SponsorSlot; clip_id: string; item_id: string; at_tl: number; revision: number }>(
        `${V1}/sponsor-slots/${encodeURIComponent(id)}/accept`,
        { clip_id: clipId },
      ),
    onSuccess: (out) => {
      void qc.invalidateQueries({ queryKey: mk.briefs(itemId) })
      void qc.invalidateQueries({ queryKey: ['edit', out.clip_id] })
      void qc.invalidateQueries({ queryKey: ['clips'] })
    },
  })
}

/** "1,200 USD" style money; `null` shows a dash. */
export function money(value: number | null | undefined, currency: string | null = 'USD'): string {
  if (value == null) return '–'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${Math.round(value).toLocaleString()} ${currency ?? ''}`.trim()
  }
}
