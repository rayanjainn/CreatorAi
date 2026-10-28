'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FlipHorizontal2, Minus, Pause, Play, Plus, RotateCcw, Type } from 'lucide-react'
import { useContentItem, useScript } from '@/lib/api/hooks'
import { stripDemo } from '@/lib/format'
import type { Card, Script } from '@/lib/api/types'

type Prefs = { wpm: number; size: number; mirror: boolean }
const KEY = 'creatorai.teleprompter'
const DEFAULTS: Prefs = { wpm: 150, size: 44, mirror: false }

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>) }
  } catch {
    return DEFAULTS
  }
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * Teleprompter: the current script, full screen, scrolling at a speaking pace you set (words per minute).
 * Space plays and pauses, arrows nudge, + and - change the pace, M mirrors for a beam-splitter rig, Esc goes back.
 */
export default function TeleprompterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const item = useContentItem(id).data as Card | undefined
  const script = useScript(id)
  const s = script.data as Script | null | undefined

  if (script.isPending) return <div className="tp tp-center">Loading the script…</div>
  if (!s || !s.scenes?.length)
    return (
      <div className="tp tp-center">
        <div style={{ textAlign: 'center', display: 'grid', gap: 14 }}>
          <p>This project has no script yet.</p>
          <Link className="button button-secondary" href={`/projects/${id}/script`}>
            Write the script
          </Link>
        </div>
      </div>
    )
  return <Prompter id={id} title={item ? stripDemo(item.title) : 'Script'} script={s} />
}

function Prompter({ id, title, script }: { id: string; title: string; script: Script }) {
  // rendered only after the script loads in the browser, so reading storage here never runs on the server
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [playing, setPlaying] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [chrome, setChrome] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const pos = useRef(0)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scenes = script.scenes
  const words = useMemo(() => scenes.reduce((n, sc) => n + sc.text.split(/\s+/).filter(Boolean).length, 0), [scenes])
  const totalSec = (words / prefs.wpm) * 60

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      /* private window */
    }
  }, [prefs])

  // scroll speed: the text block's height spread over the time it takes to say every word at this pace
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const el = scroller.current
      const body = text.current
      if (el && body) {
        const travel = body.offsetHeight
        const pxPerSec = travel / Math.max(1, totalSec)
        pos.current = Math.min(el.scrollHeight - el.clientHeight, pos.current + ((now - last) / 1000) * pxPerSec)
        el.scrollTop = pos.current
        setProgress(travel ? Math.min(1, pos.current / travel) : 0)
        if (pos.current >= el.scrollHeight - el.clientHeight - 1) setPlaying(false)
      }
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, totalSec])

  useEffect(() => {
    if (countdown === null) return
    const t = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(null)
        setPlaying(true)
      } else setCountdown(countdown - 1)
    }, 800)
    return () => clearTimeout(t)
  }, [countdown])

  const toggle = useCallback(() => {
    if (playing) setPlaying(false)
    else if (countdown === null) {
      if (pos.current < 4) setCountdown(3)
      else setPlaying(true)
    }
  }, [playing, countdown])

  const restart = () => {
    setPlaying(false)
    setCountdown(null)
    pos.current = 0
    if (scroller.current) scroller.current.scrollTop = 0
    setProgress(0)
  }
  const nudge = (px: number) => {
    const el = scroller.current
    if (!el) return
    pos.current = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, pos.current + px))
    el.scrollTop = pos.current
  }
  const setWpm = (d: number) => setPrefs((p) => ({ ...p, wpm: Math.max(80, Math.min(240, p.wpm + d)) }))
  const setSize = (d: number) => setPrefs((p) => ({ ...p, size: Math.max(24, Math.min(96, p.size + d)) }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowDown') nudge(60)
      else if (e.key === 'ArrowUp') nudge(-60)
      else if (e.key === '+' || e.key === '=') setWpm(10)
      else if (e.key === '-') setWpm(-10)
      else if (e.key.toLowerCase() === 'm') setPrefs((p) => ({ ...p, mirror: !p.mirror }))
      else if (e.key === 'Escape') window.history.back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  // the controls fade away while reading and come back on mouse movement
  const wake = () => {
    setChrome(true)
    if (idle.current) clearTimeout(idle.current)
    idle.current = setTimeout(() => setChrome(false), 2200)
  }

  return (
    <div className="tp" data-chrome={chrome || !playing || undefined} onMouseMove={wake} data-testid="teleprompter">
      <header className="tp-top">
        <Link href={`/projects/${id}/script`} className="tp-back" aria-label="Back to the script">
          <ArrowLeft size={15} /> {title}
        </Link>
        <span className="tp-time">
          {clock(progress * totalSec)} / {clock(totalSec)}
        </span>
      </header>

      <div className="tp-scroll" ref={scroller} onWheel={() => (pos.current = scroller.current?.scrollTop ?? 0)}>
        <div className="tp-text" ref={text} style={{ fontSize: prefs.size, transform: prefs.mirror ? 'scaleX(-1)' : undefined }} data-testid="tp-text">
          {scenes.map((sc) => (
            <section key={sc.idx}>
              <h2>{sc.title}</h2>
              <p>{sc.text}</p>
            </section>
          ))}
          <p className="tp-end">End of script</p>
        </div>
      </div>
      <div className="tp-guide" aria-hidden />
      {countdown !== null && countdown > 0 && (
        <div className="tp-countdown" aria-live="assertive">
          {countdown}
        </div>
      )}
      <div className="tp-progress" aria-hidden>
        <i style={{ width: `${progress * 100}%` }} />
      </div>

      <footer className="tp-controls" aria-label="Teleprompter controls">
        <button type="button" onClick={restart} aria-label="Back to the start" title="Back to the start">
          <RotateCcw size={16} />
        </button>
        <button type="button" className="tp-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-testid="tp-play">
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div className="tp-stepper" aria-label="Speaking pace">
          <button type="button" onClick={() => setWpm(-10)} aria-label="Slower">
            <Minus size={14} />
          </button>
          <span data-testid="tp-wpm">{prefs.wpm} wpm</span>
          <button type="button" onClick={() => setWpm(10)} aria-label="Faster">
            <Plus size={14} />
          </button>
        </div>
        <div className="tp-stepper" aria-label="Text size">
          <button type="button" onClick={() => setSize(-4)} aria-label="Smaller text">
            <Minus size={14} />
          </button>
          <span>
            <Type size={14} />
          </span>
          <button type="button" onClick={() => setSize(4)} aria-label="Larger text">
            <Plus size={14} />
          </button>
        </div>
        <button type="button" aria-pressed={prefs.mirror} onClick={() => setPrefs((p) => ({ ...p, mirror: !p.mirror }))} aria-label="Mirror the text" title="Mirror (M)">
          <FlipHorizontal2 size={16} />
        </button>
        <span className="tp-keys">Space play · ↑↓ nudge · +/− pace · M mirror · Esc back</span>
      </footer>
    </div>
  )
}
