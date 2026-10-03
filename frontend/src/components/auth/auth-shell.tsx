'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Boxes, Clapperboard, Search, ShieldCheck, Sparkles } from 'lucide-react'

/** Split-screen auth layout: form on the left, promo on the right (degrades to a feature panel if the video can not play). */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-inner">
          <Link href="/" className="auth-logo" aria-label="CreatorAI home">
            <Sparkles size={32} color="#fff" />
          </Link>
          <h1 className="auth-title" style={{ fontFamily: 'inherit' }}>
            {title}
          </h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
          {children}
        </div>
      </div>
      <div className="auth-hero" aria-hidden={false}>
        <div style={{ width: '100%', maxWidth: 920, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 3.4vw, 48px)', fontWeight: 400, textAlign: 'center', marginBottom: 12, color: '#fff' }}>
            Introducing CreatorAI editor
          </h2>
          <p style={{ color: '#ffffff99', textAlign: 'center', marginBottom: 36, fontSize: 14, maxWidth: 560 }}>
            A professional online video editor with AI editing agents you can assign real work to.
          </p>
          <PromoVideo />
        </div>
      </div>
    </div>
  )
}

const FALLBACK = [
  { Icon: Search, t: 'Search your footage', d: 'Ask for a moment in plain words and jump to the exact timecode.' },
  { Icon: Boxes, t: 'Match script to footage', d: 'See which beats are covered, which are weak and what to reshoot.' },
  { Icon: Clapperboard, t: 'Smart clips', d: 'Scored short-form clips with captions, ready to render.' },
  { Icon: ShieldCheck, t: 'Local-first', d: 'Your media and database stay on this machine. Everything generated is labelled.' },
]

function PromoVideo() {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  return (
    <div className="promo-frame">
      {state !== 'failed' && (
        <video
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          aria-label="Product promo video"
          onLoadedData={() => setState('ok')}
          onError={() => setState('failed')}
          style={{ opacity: state === 'ok' ? 1 : 0, transition: 'opacity .4s' }}
        >
          <source src="/InvideoEditorPromo.mp4" type="video/mp4" onError={() => setState('failed')} />
        </video>
      )}
      {state !== 'ok' && (
        <div className="promo-fallback">
          {FALLBACK.map(({ Icon, t, d }) => (
            <div key={t}>
              <Icon size={18} style={{ color: '#c4b5fd', marginBottom: 10 }} />
              <b>{t}</b>
              <p>{d}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
