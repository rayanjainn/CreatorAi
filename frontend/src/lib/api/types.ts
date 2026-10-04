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
    captions?: { renderer: 'libass' | 'pillow'; libass: boolean }
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

/* ---------------------------------------------------------------------------------------------- */
/* Library: assets, uploads, search                                                                */
/* ---------------------------------------------------------------------------------------------- */

export type Asset = S['AssetOut']
export type AssetDetail = S['AssetDetail']
export type AssetWarning = S['AssetWarning']
export type AssetPatch = S['AssetPatch']
export type AssetKind = 'video' | 'audio' | 'image' | 'document'
export type AssetStatus = 'uploaded' | 'processing' | 'ready' | 'failed'
export type Shot = S['ShotOut']
export type Segment = S['SegmentOut']
export type Transcript = S['TranscriptOut']
export type TranscriptWord = S['TranscriptWord']
export type TranscriptSegment = S['TranscriptSegment']
export type SearchHit = S['SearchHit']
export type SearchOut = S['SearchOut']
export type UploadOut = S['UploadOut']
export type UploadComplete = S['UploadComplete']

/** `AssetDetail.analysis` is an open object; these are the keys the UI reads. */
export type AssetAnalysis = {
  error_code?: string
  failed_stage?: string
  probe?: { has_audio?: boolean; has_video?: boolean; format?: string }
  silences?: [number, number][]
  silence_total_sec?: number
  energy?: number[]
  asr?: { source?: string; provider?: string; model?: string; language?: string; words?: number; words_estimated?: boolean; no_speech?: boolean }
  shots?: { method?: string; count?: number }
  embedder?: { backend?: string; model?: string; real?: boolean }
  text?: string
  text_chars?: number
}

/* ---------------------------------------------------------------------------------------------- */
/* Director                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export type PlanStructureItem = { section: string; goal?: string; duration_sec: number; notes?: string }
export type ShotEntry = { scene: number; shot_type: string; framing: string; b_roll?: string; note?: string }
export type PlanBody = {
  domain?: string
  objective?: string
  audience?: string
  angle: string
  structure: PlanStructureItem[]
  storytelling: string[]
  shot_list: ShotEntry[]
  hook_ideas: string[]
  cta: string
  risks: string[]
}
export type Plan = Omit<S['PlanOut'], 'plan' | 'inputs' | 'edited_by_user' | 'shot_provenance'> & {
  plan: PlanBody
  inputs: { platform?: string; target_duration_sec?: number; objective?: string; audience?: string; domain?: string }
  edited_by_user: { shot_list?: number[] }
  shot_provenance: Provenance[]
}
export type PlanRequest = S['PlanRequest']
export type PlanVersion = S['PlanVersionOut']

export type ReviewScoreKey = 'hook' | 'clarity' | 'pacing' | 'coverage' | 'cta'
export type ReviewIssue = {
  type: string
  severity: 'high' | 'medium' | 'low' | string
  at_sec?: number | null
  scene_idx?: number | null
  asset_id?: string | null
  asset_sec?: number | null
  fix?: string
}
export type ReviewWarning = { code: string; message?: string }
export type Review = Omit<S['ReviewOut'], 'scores' | 'issues' | 'missing_scenes' | 'warnings' | 'metrics' | 'provenance_by_part'> & {
  scores: Partial<Record<ReviewScoreKey, number | null>>
  issues: ReviewIssue[]
  missing_scenes: { scene_idx?: number; title?: string; text?: string; beats?: string[]; suggestion?: string }[]
  warnings: ReviewWarning[]
  metrics: { coverage_known?: boolean; wpm?: number; [k: string]: unknown }
  provenance_by_part: { scores?: Provenance; text?: Provenance }
}
export type ReviewVersion = S['ReviewVersionOut']

/* ---------------------------------------------------------------------------------------------- */
/* Scripts                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export type Beat = { idx: number; text: string; intent?: string; est_sec: number }
export type Scene = {
  idx: number
  title: string
  intent?: string
  est_sec: number
  text: string
  beats: Beat[]
  provenance?: Provenance
  edited_by_user?: boolean
}
export type HookOption = { text: string; type: string; why?: string; signal_score: number; detected_type?: string; provenance?: Provenance }
export type ScriptMeta = {
  titles: string[]
  description: string
  ctas: string[]
  captions: string[]
  tags: string[]
  supporting: { pinned_comment?: string; thumbnail_text?: string[]; [k: string]: unknown }
}
export type Script = Omit<S['ScriptOut'], 'scenes' | 'hook_options' | 'meta' | 'counters' | 'provenance_by_part' | 'edited_by_user' | 'generation'> & {
  scenes: Scene[]
  hook_options: HookOption[]
  meta: ScriptMeta
  counters: { word_count: number; est_sec: number; target_sec: number | null; target_words: number | null; scene_count: number; beat_count: number }
  provenance_by_part: { body_md?: Provenance; selected_hook?: Provenance; meta?: Provenance; scenes?: Record<string, Provenance> }
  edited_by_user: { body_md?: boolean; selected_hook?: boolean; meta?: boolean; scenes?: number[] }
  generation: { ratio?: number; within_tolerance?: boolean; hook_repaired?: boolean; used_plan_structure?: boolean; plan_version?: number }
}
export type ScriptVersion = S['ScriptVersionOut']
export type HooksOut = Omit<S['HooksOut'], 'hooks'> & { hooks: HookOption[] }
export type SceneInput = { title?: string; intent?: string; text?: string }
export type ScriptPatch = { body_md?: string; selected_hook?: string; scenes?: SceneInput[]; meta?: Partial<Omit<ScriptMeta, 'supporting'>> & { supporting?: ScriptMeta['supporting'] } }
export type GenerateScriptRequest = S['GenerateScriptRequest']
export type SceneRewrite = Omit<S['SceneRewriteOut'], 'script'> & { script: Script }

/* ---------------------------------------------------------------------------------------------- */
/* Matching, clips, renders                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export type MatchStatus = 'matched' | 'weak' | 'missing' | 'confirmed' | 'rejected' | 'unmatched'
export type BeatMatch = S['BeatMatchOut']
export type Alternative = S['AlternativeOut']
export type Coverage = S['CoverageOut']
export type SceneIssue = S['SceneIssueOut']
export type Match = Omit<S['MatchOut'], 'embedder'> & { embedder: { backend?: string; model?: string; real?: boolean; match_ok?: number; match_weak?: number } }
export type Clip = S['ClipOut']
export type ClipStatus = 'suggested' | 'accepted' | 'rejected'
export type Render = S['RenderOut']
export type RenderPreset = Render['preset']
export type CaptionStyle = NonNullable<Render['caption_style']>

export type LumiclipProject = S['LumiclipProjectOut']
export type LumiclipClip = S['LumiclipClipOut']
export type LumiclipStart = S['LumiclipStart']
export type YtdlpDownloadRequest = S['YtdlpDownloadRequest']
export type YtdlpDownloadOut = S['YtdlpDownloadOut']

export type Workspace = S['WorkspaceOut']
export type Member = S['MemberOut']
export type Invite = S['InviteOut']
export type InvitePreview = S['InvitePreview']
export type ProjectMember = S['ProjectMemberOut']
export type Comment = S['CommentOut']
export type Presence = S['PresenceOut']

/** GET /insights/production: counts from the creator's own workspace (see backend/app/services/insights.py). */
export type InsightsReport = {
  generated_at: string
  range_days: number
  basis: string
  pipeline: {
    total: number
    by_stage: Record<string, number>
    weekly: { week: string; created: number; published: number }[]
    avg_days_to_publish: number | null
    stale: { id: string; title: string; stage: string; days: number }[]
    stale_days: number
  }
  footage: { assets: number; ready: number; hours: number; gigabytes: number; by_kind: Record<string, number>; failed: number }
  clips: {
    total: number
    by_status: Record<string, number>
    by_kind: Record<string, number>
    accept_rate: number | null
    avg_score: number | null
    score_buckets: { from: number; to: number; count: number }[]
    avg_length_sec: number | null
    accepted_avg_length_sec: number | null
  }
  scripts: { count: number; avg_length_sec: number | null; by_platform: Record<string, number>; by_tone: Record<string, number> }
  renders: { total: number; done: number; failed: number; by_preset: Record<string, number>; minutes: number }
  activity: { date: string; count: number }[]
  performance: { available: boolean; reason: string }
  nudges: { kind: string; text: string; href: string }[]
}

/** Digital Twin (backend/app/services/twin.py). */
export type TwinStyle = { summary?: string; tone_descriptors?: string[]; vocabulary?: { favor: string[]; avoid: string[] }; dos?: string[]; donts?: string[]; provenance?: { source: string; provider?: string | null; model?: string | null } }
export type TwinOverview = { style: TwinStyle; style_revision: number; approvals_since_update: number; update_every: number; memory_count: number; memories: { id: string; kind: string; text: string; created_at: string }[] }
export type TwinAction = { type: string; clip_id?: string | null; content_item_id?: string | null; params?: Record<string, unknown> }
export type TwinMessage = { id: string; role: 'user' | 'assistant'; content: string; actions: TwinAction[]; provenance?: { source: string; provider?: string | null; model?: string | null } | null; created_at: string }
export type TwinApplied = { applied: boolean; kind: string; message: string; open_editor?: boolean; clip_id?: string | null; content_item_id?: string | null }

/** Research agent (backend/app/services/research.py). */
export type ResearchBrief = { id: string; topic: string; content_item_id: string | null; created_at: string; provenance?: { source: string; provider?: string | null; model?: string | null } | null; doc: { summary: string; key_points: string[]; trends: string[]; sources: { title: string; url: string }[] } }
