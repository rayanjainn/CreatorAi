import type { components } from './schema'

type S = components['schemas']

export type Stage = 'idea' | 'script' | 'shoot' | 'edit' | 'review' | 'published'
export type Domain = S['ProfileOut']['domain']

export type Me = S['MeOut']
export type Profile = S['ProfileOut']
export type ProfileUpdate = S['ProfileUpdate']
export type OnboardingRequest = S['OnboardingRequest']
export type TokenOut = S['TokenOut']

export type Card = Omit<S['CardOut'], 'stage'> & { stage: Stage }
export type Board = { columns: { stage: Stage; count: number; cards: Card[] }[]; total: number }
export type ContentCreate = S['ContentCreate']
export type ContentPatch = S['ContentPatch']
export type ContentItem = S['ContentItemOut']
export type DeleteOut = S['DeleteOut']
export type Idea = S['IdeaOut']
export type IdeasGenerateOut = S['IdeasGenerateOut']
export type Job = S['JobOut']
export type Activity = S['ActivityOut']
export type Page<T> = { items: T[]; total: number; limit: number; offset: number }

export type ProvenanceSource = 'ai' | 'mock' | 'heuristic' | 'demo' | 'user'
export type Provenance = { source: ProvenanceSource; provider?: string | null; model?: string | null }

export type DataMode = 'real' | 'mock' | 'unconfigured'

export type ProviderFlags = Record<string, { configured: boolean; healthy: boolean }>

/** `GET /health` (typed by hand: the OpenAPI schema is an open object). */
export type Health = {
  status: string
  version: string
  time: string
  python: string
  auth_mode: string
  data_mode: DataMode
  signup_open?: boolean
  features: {
    llm: { data_mode: DataMode; order: string[]; providers: ProviderFlags; mock: boolean }
    asr: { sidecar: boolean; groq: boolean; faster_whisper: boolean }
    embedder: {
      backend: string
      real: boolean
      model: string
      dim: number
      provenance: Provenance
      match_ok: number
      match_weak: number
    }
    ffmpeg: { present: boolean; version: string | null }
    youtube: { configured: boolean }
  }
}

/** `GET /llm/status` */
export type LlmStatus = {
  providers: Record<
    string,
    {
      configured: boolean
      healthy: boolean
      circuit_open_sec: number
      usage_today: { calls: number; cache_hits: number }
    }
  >
  cache_hits_today: number
  allow_mock: boolean
  data_mode: DataMode
  provider_order: string[]
  models: Record<string, string>
  tasks: string[]
}

/** `POST /llm/test`: one entry per provider in the chain (plus `mock` when enabled). */
export type LlmTestResult = {
  configured: boolean
  ok: boolean
  latency_ms: number | null
  model: string | null
  error: string | null
}
export type LlmTest = { data_mode: DataMode; results: Record<string, LlmTestResult> }

export type ApiErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } }
