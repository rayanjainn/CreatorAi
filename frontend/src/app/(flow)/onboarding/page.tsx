'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Sparkles, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { DOMAINS } from '@/components/board/new-content-dialog'
import { CAPTION_STYLES, CaptionPreview, type CaptionStyleId } from '@/components/onboarding/caption-preview'
import { NotAvailableInline } from '@/components/common/not-available'
import { useAuth } from '@/components/auth-provider'
import { useOnboarding } from '@/lib/api/hooks'
import type { Domain } from '@/lib/api/types'
import { errorMessage } from '@/lib/api/errors'
import { toast } from '@/stores/toasts'

const STEPS = ['Your channel', 'Your style', 'Sample scripts', 'Connect & finish']
const TONES = ['conversational', 'direct', 'friendly', 'energetic', 'calm', 'witty', 'authoritative', 'educational', 'no-fluff', 'storytelling']
const PLATFORMS = [
  { id: 'youtube_shorts', label: 'YouTube Shorts' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'instagram_reels', label: 'Instagram Reels' },
  { id: 'tiktok', label: 'TikTok' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const { profile, me } = useAuth()
  const save = useOnboarding()
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)

  const [name, setName] = useState(profile?.display_name ?? '')
  const [channel, setChannel] = useState(me?.workspace_name && me.workspace_name !== 'My workspace' ? me.workspace_name : '')
  const [domain, setDomain] = useState<Domain>(profile?.domain ?? 'technology')
  const [audience, setAudience] = useState(profile?.audience ?? '')
  const [platforms, setPlatforms] = useState<string[]>(profile?.platforms?.length ? profile.platforms : ['youtube_shorts'])
  const [tones, setTones] = useState<string[]>(() => (profile?.tone ? profile.tone.split(',').map((t) => t.trim()).filter(Boolean) : ['conversational']))
  const [caption, setCaption] = useState<CaptionStyleId>('bold_center')
  const [aspect, setAspect] = useState<'9:16' | '16:9'>('9:16')
  const [scripts, setScripts] = useState<string[]>(['', '', ''])

  const go = (n: number) => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? tones.length > 0 : true

  const finish = (e?: FormEvent) => {
    e?.preventDefault()
    save.mutate(
      {
        display_name: name.trim() || 'Creator',
        channel_name: channel.trim() || undefined,
        domain,
        audience: audience.trim(),
        tone: tones.join(', ') || 'conversational',
        language: profile?.language || 'en',
        platforms: platforms.length ? platforms : ['youtube_shorts'],
        caption_style: caption,
        preferred_aspect: aspect,
        sample_scripts: scripts.map((s) => s.trim()).filter(Boolean),
      },
      {
        onSuccess: (out) => {
          if (out.memories_created) toast.success(`Saved ${out.memories_created} sample script${out.memories_created === 1 ? '' : 's'}`)
          router.replace('/calendar')
        },
      },
    )
  }

  return (
    <div className="flow-page">
      <div className="flow-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" className="brand" style={{ padding: 0, textDecoration: 'none' }}>
            <div className="brand-mark">
              <Sparkles size={18} />
            </div>
            <strong>
              Creator<span>AI</span>
            </strong>
          </Link>
          <small>
            Step {step + 1} of {STEPS.length}
          </small>
        </div>

        <ol className="wizard-steps" aria-label="Progress" style={{ listStyle: 'none', padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s} className={`wizard-step ${i < step ? 'done' : i === step ? 'current' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <b>{String(i + 1).padStart(2, '0')}</b>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <form className="wizard-card" onSubmit={(e) => e.preventDefault()}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 * dir }} transition={{ duration: 0.18 }}>
              {step === 0 && (
                <>
                  <h2>Tell us about your channel</h2>
                  <p className="lead">This is the context the AI tools start from. You can change all of it later in Settings.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="form-grid">
                      <Field label="Your name" htmlFor="ob-name">
                        <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
                      </Field>
                      <Field label="Channel or brand name" htmlFor="ob-channel" hint="Optional">
                        <Input id="ob-channel" value={channel} onChange={(e) => setChannel(e.target.value)} maxLength={80} />
                      </Field>
                    </div>
                    <Field label="What do you make videos about?" htmlFor="ob-domain">
                      <Select id="ob-domain" value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
                        {DOMAINS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Who is your audience?" htmlFor="ob-aud" hint="One or two sentences. e.g. beginner video editors on a laptop">
                      <Textarea id="ob-aud" value={audience} onChange={(e) => setAudience(e.target.value)} rows={2} maxLength={500} />
                    </Field>
                    <div className="field">
                      <span className="field-label">Where do you publish?</span>
                      <div className="chip-row">
                        {PLATFORMS.map((p) => (
                          <button key={p.id} type="button" className="chip" aria-pressed={platforms.includes(p.id)} onClick={() => toggle(platforms, setPlatforms, p.id)}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <h2>Pick your style</h2>
                  <p className="lead">A starting point for tone and captions. It is yours to refine; nothing here is learned from your videos yet.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div className="field">
                      <span className="field-label">Tone (choose a few)</span>
                      <div className="chip-row">
                        {TONES.map((t) => (
                          <button key={t} type="button" className="chip" aria-pressed={tones.includes(t)} onClick={() => toggle(tones, setTones, t)}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">Caption style</span>
                      <div className="caption-previews" role="group" aria-label="Caption style">
                        {CAPTION_STYLES.map((c) => (
                          <button key={c.id} type="button" className="caption-option" aria-pressed={caption === c.id} onClick={() => setCaption(c.id)}>
                            <CaptionPreview id={c.id} />
                            <b>{c.label}</b>
                            <small>{c.hint}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">Preferred aspect ratio</span>
                      <div className="aspect-pick" role="group" aria-label="Preferred aspect ratio">
                        <button type="button" aria-pressed={aspect === '9:16'} onClick={() => setAspect('9:16')}>
                          <span className="aspect-box" style={{ width: 12, height: 20 }} /> 9:16 vertical
                        </button>
                        <button type="button" aria-pressed={aspect === '16:9'} onClick={() => setAspect('16:9')}>
                          <span className="aspect-box" style={{ width: 22, height: 13 }} /> 16:9 landscape
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <h2>Show us how you write</h2>
                  <p className="lead">Optional. Paste two or three scripts you are proud of. They are stored on this machine as style references for your Creative Twin.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {scripts.map((s, i) => (
                      <Field key={i} label={`Sample script ${i + 1}`} htmlFor={`ob-s${i}`}>
                        <Textarea id={`ob-s${i}`} value={s} onChange={(e) => setScripts(scripts.map((x, j) => (j === i ? e.target.value : x)))} rows={4} maxLength={8000} placeholder="Paste a script or transcript…" />
                      </Field>
                    ))}
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <h2>Connect YouTube, later</h2>
                  <p className="lead">You are ready to go. One last thing worth knowing:</p>
                  <NotAvailableInline title="YouTube connection is not available yet" icon={<Video size={16} />}>
                    Publishing and real channel analytics are not part of this build, so there is nothing to connect. You can skip this: it will not block anything.
                  </NotAvailableInline>
                  <div className="card" style={{ marginTop: 16, boxShadow: 'none', background: '#17171d' }}>
                    <b style={{ fontSize: 13 }}>You are about to save</b>
                    <dl className="kv" style={{ marginTop: 10 }}>
                      <dt>Name</dt>
                      <dd>{name}</dd>
                      <dt>Topic area</dt>
                      <dd style={{ textTransform: 'capitalize' }}>{domain}</dd>
                      <dt>Tone</dt>
                      <dd>{tones.join(', ')}</dd>
                      <dt>Captions</dt>
                      <dd>{CAPTION_STYLES.find((c) => c.id === caption)?.label}</dd>
                      <dt>Aspect</dt>
                      <dd>{aspect}</dd>
                      <dt>Sample scripts</dt>
                      <dd>{scripts.filter((s) => s.trim()).length}</dd>
                    </dl>
                  </div>
                  {save.isError && (
                    <p className="field-error" style={{ marginTop: 12 }}>
                      {errorMessage(save.error)}
                    </p>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="wizard-foot">
            <div>
              {step > 0 && (
                <Button variant="ghost" onClick={() => go(step - 1)} disabled={save.isPending}>
                  <ArrowLeft size={14} /> Back
                </Button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {step === 2 && (
                <Button variant="secondary" onClick={() => go(3)}>
                  Skip
                </Button>
              )}
              {step < 3 ? (
                <Button onClick={() => go(step + 1)} disabled={!canNext} data-testid="wizard-next">
                  Continue <ArrowRight size={14} />
                </Button>
              ) : (
                <Button onClick={() => finish()} loading={save.isPending} data-testid="wizard-finish">
                  <Check size={14} /> Go to board
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
