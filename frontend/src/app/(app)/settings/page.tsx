'use client'

import { useEffect, useId, useState, type FormEvent, Suspense } from 'react'
import { CheckCircle2, KeyRound, Play, Save, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { YoutubeCard } from '@/components/settings/youtube-card'
import { AccountCard } from '@/components/settings/account-card'
import { UsageCard } from '@/components/settings/usage-card'
import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { DOMAINS } from '@/components/board/new-content-dialog'
import { CaptionPreview, CAPTION_STYLES } from '@/components/onboarding/caption-preview'
import { useAuth } from '@/components/auth-provider'
import { useRole } from '@/lib/use-role'
import { TeamCard } from '@/components/team/team-card'
import { useHealth, useLlmStatus, useLlmTest, useUpdateProfile } from '@/lib/api/hooks'
import type { DataMode, Domain, Profile, Provenance } from '@/lib/api/types'
import { errorMessage } from '@/lib/api/errors'
import { toast } from '@/stores/toasts'

const MODE_COPY: Record<DataMode, { tone: string; label: string; text: string }> = {
  real: { tone: 'badge-green', label: 'Live AI', text: 'Real model providers are configured. Generated content is labelled with its provider and model.' },
  mock: { tone: 'badge-amber', label: 'Mock mode', text: 'Only the deterministic mock provider is available. Output is NOT real AI and is labelled as mock everywhere.' },
  unconfigured: { tone: 'badge-red', label: 'Not configured', text: 'No AI provider is configured, so AI features are switched off instead of faking results.' },
}

function ProfileCard({ profile }: { profile: Profile }) {
  const update = useUpdateProfile()
  const ids = { name: useId(), domain: useId(), audience: useId(), tone: useId(), lang: useId() }
  const [form, setForm] = useState({ display_name: profile.display_name, domain: profile.domain, audience: profile.audience, tone: profile.tone, language: profile.language })
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== profile[k])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    update.mutate(form, { onSuccess: () => toast.success('Profile saved') })
  }
  return (
    <section className="card" aria-labelledby="profile-h">
      <div className="card-heading">
        <div>
          <div className="eyebrow">You</div>
          <h2 id="profile-h">Profile</h2>
        </div>
      </div>
      <form onSubmit={submit} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-grid">
          <Field label="Display name" htmlFor={ids.name}>
            <Input id={ids.name} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required maxLength={80} />
          </Field>
          <Field label="Topic area" htmlFor={ids.domain}>
            <Select id={ids.domain} value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value as Domain })}>
              {DOMAINS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Audience" htmlFor={ids.audience} hint="Who you make videos for. The AI uses this as context.">
          <Textarea id={ids.audience} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} rows={2} maxLength={500} />
        </Field>
        <div className="form-grid">
          <Field label="Tone" htmlFor={ids.tone} hint="Comma separated, e.g. direct, friendly">
            <Input id={ids.tone} value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} maxLength={200} />
          </Field>
          <Field label="Language" htmlFor={ids.lang}>
            <Input id={ids.lang} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} maxLength={16} />
          </Field>
        </div>
        <div>
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            <Save size={14} /> Save profile
          </Button>
        </div>
      </form>
    </section>
  )
}

function LlmCard() {
  const status = useLlmStatus()
  const health = useHealth()
  const test = useLlmTest()
  const mode = status.data?.data_mode ?? health.data?.data_mode
  const providers = status.data?.providers

  return (
    <section className="card span-2" id="llm" aria-labelledby="llm-h" data-testid="llm-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">AI providers</div>
          <h2 id="llm-h">Language models</h2>
        </div>
        {mode && (
          <span className={`badge ${MODE_COPY[mode].tone} badge-dot`} data-testid="data-mode-badge" data-mode={mode}>
            {MODE_COPY[mode].label}
          </span>
        )}
      </div>
      {status.isPending ? (
        <Skeleton style={{ height: 160, marginTop: 16 }} />
      ) : status.isError ? (
        <div style={{ marginTop: 16 }}>
          <ErrorState error={status.error} onRetry={() => status.refetch()} title="Could not read AI status" />
        </div>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: '12px 0 4px' }}>
            {mode ? MODE_COPY[mode].text : ''} Order tried: {status.data.provider_order.join(' → ')}.
          </p>
          <div style={{ marginTop: 8 }}>
            {Object.entries(providers ?? {}).map(([name, p]) => (
              <div className="status-row" key={name} data-testid={`provider-${name}`}>
                <span className={p.configured ? (p.healthy ? 'ok-dot' : 'warn-dot') : 'bad-dot'} aria-hidden />
                <span className="status-main">
                  <b style={{ textTransform: 'capitalize' }}>{name}</b>
                  <small>
                    {p.configured ? (p.healthy ? 'Configured' : `Circuit open for ${Math.ceil(p.circuit_open_sec)}s after repeated failures`) : name === 'mock' ? 'Offline stand-in' : 'Not configured'}
                    {' · '}
                    {p.usage_today.calls} call{p.usage_today.calls === 1 ? '' : 's'} today
                    {p.usage_today.cache_hits ? `, ${p.usage_today.cache_hits} cached` : ''}
                  </small>
                </span>
                {name === 'mock' && <ProvenanceBadge source="mock" />}
                <span className={`badge ${p.configured ? 'badge-green' : 'badge-gray'}`}>{p.configured ? 'on' : 'off'}</span>
              </div>
            ))}
          </div>

          {mode === 'unconfigured' && (
            <div className="setup-card" style={{ margin: '14px 0 0' }}>
              <div className="stat-icon amber">
                <KeyRound size={17} />
              </div>
              <div>
                <h3>Add at least one free key</h3>
                <p>Put one of these in the repo&apos;s <code className="env">.env</code> file and restart the API (<code className="env">make dev</code>). All three have free tiers.</p>
                <ul>
                  <li>
                    <code>GEMINI_API_KEY</code> · aistudio.google.com/apikey
                  </li>
                  <li>
                    <code>GROQ_API_KEY</code> · console.groq.com/keys
                  </li>
                  <li>
                    <code>OLLAMA_API_KEY</code> · ollama.com/settings/keys
                  </li>
                </ul>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending} data-testid="test-keys">
              <Play size={14} /> Test my keys
            </Button>
            <small>Sends one tiny real request to every configured provider.</small>
          </div>
          {test.isError && (
            <p className="field-error" style={{ marginTop: 10 }}>
              {errorMessage(test.error)}
            </p>
          )}
          {test.data && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="test-results">
              {Object.entries(test.data.results).map(([name, r]) => (
                <div key={name} className={`provider-result ${r.ok ? 'ok' : 'fail'}`} data-testid={`test-${name}`}>
                  {r.ok ? <CheckCircle2 size={16} color="var(--success)" style={{ flex: 'none', marginTop: 1 }} /> : <XCircle size={16} color="var(--danger)" style={{ flex: 'none', marginTop: 1 }} />}
                  <div style={{ minWidth: 0 }}>
                    <b style={{ textTransform: 'capitalize' }}>{name}</b>{' '}
                    {r.ok ? (
                      <span className="muted">
                        works{r.model ? ` · ${r.model}` : ''}
                        {r.latency_ms != null ? ` · ${r.latency_ms} ms` : ''}
                      </span>
                    ) : (
                      <span className="muted">{r.configured ? `failed: ${r.error ?? 'unknown error'}` : 'not configured (no key set)'}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <dl className="kv" style={{ marginTop: 18 }}>
            {Object.entries(status.data.models).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k.replace(/_/g, ' ')}</dt>
                <dd className="mono" style={{ fontSize: 12 }}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

function Row({ ok, warn, title, detail, right }: { ok?: boolean; warn?: boolean; title: string; detail: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="status-row">
      <span className={ok ? 'ok-dot' : warn ? 'warn-dot' : 'bad-dot'} aria-hidden />
      <span className="status-main">
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      {right}
    </div>
  )
}

function PipelineCard() {
  const health = useHealth()
  const f = health.data?.features
  return (
    <section className="card" aria-labelledby="pipe-h" data-testid="pipeline-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow">Local pipeline</div>
          <h2 id="pipe-h">Media & search engine</h2>
        </div>
        {health.data && <small>API v{health.data.version}</small>}
      </div>
      <div style={{ marginTop: 8 }}>
        {health.isPending ? (
          <Skeleton style={{ height: 150 }} />
        ) : health.isError ? (
          <ErrorState error={health.error} onRetry={() => health.refetch()} />
        ) : f ? (
          <>
            <Row
              ok={f.embedder.real}
              warn={!f.embedder.real}
              title="Embeddings (semantic search)"
              detail={`${f.embedder.backend} · ${f.embedder.model} · ${f.embedder.dim}-d${f.embedder.real ? '' : ' · run `make models` once while online for real embeddings'}`}
              right={<ProvenanceBadge {...(f.embedder.provenance as Provenance)} />}
            />
            <Row ok title="Transcription (ASR)" detail={`Sidecar transcripts always. Groq Whisper: ${f.asr.groq ? 'on' : 'off'}. Local faster-whisper: ${f.asr.faster_whisper ? 'installed' : 'missing'}.`} />
            <Row ok={f.ffmpeg.present} title="ffmpeg" detail={f.ffmpeg.present ? (f.ffmpeg.version ?? 'installed') : 'Not found. Install ffmpeg to process and render video.'} />
            {f.ffmpeg.present && f.captions && (
              <Row
                ok
                title="Caption burn-in"
                detail={
                  f.captions.renderer === 'libass'
                    ? 'libass (ffmpeg subtitles filter)'
                    : f.captions.libass
                      ? 'Built-in renderer (forced by CAPTION_RENDERER)'
                      : 'Built-in renderer (this ffmpeg has no libass; works everywhere, libass is slightly crisper)'
                }
              />
            )}
          </>
        ) : null}
      </div>
    </section>
  )
}

function DefaultsCard({ profile }: { profile: Profile }) {
  const update = useUpdateProfile()
  const style = profile.style_profile as { captions?: { style?: string }; visual?: { preferred_aspect?: string } }
  const [caption, setCaption] = useState(style.captions?.style ?? 'bold_center')
  const [aspect, setAspect] = useState(style.visual?.preferred_aspect ?? '9:16')
  const dirty = caption !== (style.captions?.style ?? 'bold_center') || aspect !== (style.visual?.preferred_aspect ?? '9:16')
  const save = () =>
    update.mutate(
      {
        style_profile: {
          ...profile.style_profile,
          captions: { ...style.captions, style: caption },
          visual: { ...style.visual, preferred_aspect: aspect },
        },
      },
      { onSuccess: () => toast.success('Defaults saved') },
    )
  return (
    <section className="card" aria-labelledby="def-h">
      <div className="card-heading">
        <div>
          <div className="eyebrow">Renders</div>
          <h2 id="def-h">Defaults</h2>
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <span className="field-label">Caption style</span>
          <div className="caption-previews" role="group" aria-label="Caption style">
            {CAPTION_STYLES.map((c) => (
              <button key={c.id} type="button" className="caption-option" aria-pressed={caption === c.id} onClick={() => setCaption(c.id)}>
                <CaptionPreview id={c.id} />
                <b>{c.label}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Preferred aspect ratio</span>
          <div className="aspect-pick" role="group" aria-label="Preferred aspect ratio">
            {[
              { v: '9:16', w: 12, h: 20 },
              { v: '16:9', w: 22, h: 13 },
            ].map((a) => (
              <button key={a.v} type="button" aria-pressed={aspect === a.v} onClick={() => setAspect(a.v)}>
                <span className="aspect-box" style={{ width: a.w, height: a.h }} />
                {a.v}
              </button>
            ))}
          </div>
        </div>
        {profile.style_profile && (profile.style_profile as { provenance?: Provenance }).provenance?.source === 'demo' && (
          <p className="field-hint">
            <ProvenanceBadge source="demo" /> Your style profile is a hand-written demo starter, not learned from your videos.
          </p>
        )}
        <div>
          <Button onClick={save} loading={update.isPending} disabled={!dirty}>
            <Save size={14} /> Save defaults
          </Button>
        </div>
      </div>
    </section>
  )
}

export default function SettingsPage() {
  const { me, profile, logout } = useAuth()
  const { canAdmin, known, isOwner } = useRole()

  useEffect(() => {
    if (window.location.hash === '#llm') document.getElementById('llm')?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <div className="page">
      <PageHeader eyebrow="CreatorAI / System" title="Settings" description="Your profile, AI providers, local engine status and defaults." />
      <div className="settings-grid">
        {known && !canAdmin && (
          <p className="notice span-2" role="status" data-testid="settings-readonly">
            You can look at these settings, but only workspace admins can change them.
          </p>
        )}
        {profile && (
          <fieldset className="settings-fieldset" disabled={known && !canAdmin}>
            <ProfileCard key={profile.display_name + profile.domain} profile={profile} />
          </fieldset>
        )}
        {profile && (
          <fieldset className="settings-fieldset" disabled={known && !canAdmin}>
            <DefaultsCard key={`d-${profile.style_profile_rev}-${JSON.stringify(profile.style_profile).length}`} profile={profile} />
          </fieldset>
        )}
        <TeamCard />
        <LlmCard />
        <UsageCard />
        <PipelineCard />

        <Suspense fallback={null}>
          <YoutubeCard canAdmin={!known || canAdmin} />
        </Suspense>

        <AccountCard email={me?.user.email} workspaceName={me?.workspace_name} isOwner={isOwner} onSignOut={logout} />
      </div>
    </div>
  )
}

