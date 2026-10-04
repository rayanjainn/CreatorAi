'use client'

declare global {
  type SpeechRecognition = any
  type SpeechRecognitionEvent = any
  type SpeechRecognitionErrorEvent = any
}

import React, {
  useCallback, useEffect, useRef, useState, useMemo
} from 'react'

import { generateResponse, ConversationTurn } from '@/lib/twinResponseEngine'

// ─── Types ────────────────────────────────────────────────────────────────────
type VoiceState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'ERROR'

interface TranscriptEntry {
  id: string
  role: 'user' | 'twin'
  text: string
  timestamp: Date
}

interface Settings {
  rate: number
  muted: boolean
  lang: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const uid = () => Math.random().toString(36).slice(2, 9)

// ─── Waveform bars ────────────────────────────────────────────────────────────
function Waveform({ state }: { state: VoiceState }) {
  const bars = 32
  return (
    <div className="nt-wave" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`nt-bar nt-bar-${state.toLowerCase()}`}
          style={{ animationDelay: `${(i / bars) * 0.9}s` }}
        />
      ))}
    </div>
  )
}

// ─── Glowing Rotating Ring Orb ───────────────────────────────────────────────
function Orb({ state, initial = "Aarav" }: { state: VoiceState; initial?: string }) {
  return (
    <div className={`nt-ring-container nt-state-${state.toLowerCase()}`}>
      {/* Outer ambient blur backlight */}
      <div className="nt-ambient-glow" />

      {/* Glowing rotating gradient donut ring */}
      <div className="nt-glowing-ring" />

      {/* Inner dark center badge */}
      <div className="nt-center-badge">
        <div className="nt-center-circle-outline">
          <span className="nt-center-initial">{initial}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Caption display ──────────────────────────────────────────────────────────
function CaptionArea({
  state,
  interimText,
  lastUser,
  lastTwin,
}: {
  state: VoiceState
  interimText: string
  lastUser: TranscriptEntry | null
  lastTwin: TranscriptEntry | null
}) {
  return (
    <div className="nt-captions">
      {lastUser && (
        <div className="nt-caption-block nt-caption-user">
          <span className="nt-caption-label">YOU</span>
          <p className="nt-caption-text">
            "{lastUser.text}{state === 'LISTENING' && interimText ? ' ' + interimText : ''}"
          </p>
          <span className="nt-caption-time">{fmtTime(lastUser.timestamp)}</span>
        </div>
      )}
      {state === 'LISTENING' && interimText && !lastUser && (
        <div className="nt-caption-block nt-caption-user nt-interim">
          <span className="nt-caption-label">YOU</span>
          <p className="nt-caption-text">"{interimText}<span className="nt-cursor" /></p>
        </div>
      )}
      {state === 'PROCESSING' && (
        <div className="nt-caption-block nt-caption-twin">
          <span className="nt-caption-label">AARAV AI TWIN</span>
          <div className="nt-thinking">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      {lastTwin && state !== 'PROCESSING' && (
        <div className="nt-caption-block nt-caption-twin">
          <div className="nt-caption-twin-header">
            <span className="nt-caption-label">AARAV AI TWIN</span>
            {state === 'SPEAKING' && <span className="nt-speaking-dot" />}
          </div>
          <p className="nt-caption-text nt-twin-text">"{lastTwin.text}"</p>
          <span className="nt-caption-time">{fmtTime(lastTwin.timestamp)}</span>
        </div>
      )}
    </div>
  )
}

// ─── History modal ────────────────────────────────────────────────────────────
function HistoryModal({
  entries,
  onClose,
}: {
  entries: TranscriptEntry[]
  onClose: () => void
}) {
  return (
    <div className="nt-history-backdrop" onClick={onClose}>
      <div className="nt-history-modal" onClick={e => e.stopPropagation()}>
        <div className="nt-history-header">
          <h3>Conversation History</h3>
          <button className="nt-close-btn" onClick={onClose} aria-label="Close history">✕</button>
        </div>
        <div className="nt-history-list">
          {entries.length === 0 ? (
            <p className="nt-history-empty">No conversation yet. Tap the microphone to start.</p>
          ) : (
            [...entries].reverse().map(e => (
              <div key={e.id} className={`nt-history-entry nt-history-${e.role}`}>
                <span className="nt-caption-label">{e.role === 'user' ? 'YOU' : 'AARAV AI TWIN'}</span>
                <p>"{e.text}"</p>
                <span className="nt-caption-time">{fmtTime(e.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Settings panel ───────────────────────────────────────────────────────────
function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
}) {
  const langs = [
    { code: 'en-US', label: 'English (US)' },
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'en-IN', label: 'English (India)' },
    { code: 'hi-IN', label: 'Hindi' },
  ]
  return (
    <div className="nt-settings-panel">
      <div className="nt-settings-header">
        <span>Voice Settings</span>
        <button onClick={onClose} className="nt-close-btn" aria-label="Close settings">✕</button>
      </div>
      <label className="nt-settings-row">
        <span>Speech Rate</span>
        <input
          type="range" min="0.6" max="1.8" step="0.1"
          value={settings.rate}
          onChange={e => onChange({ ...settings, rate: Number(e.target.value) })}
        />
        <span className="nt-settings-val">{settings.rate.toFixed(1)}×</span>
      </label>
      <label className="nt-settings-row">
        <span>Language</span>
        <select
          value={settings.lang}
          onChange={e => onChange({ ...settings, lang: e.target.value })}
        >
          {langs.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function NeuralTwinPanel() {
  const [voiceState, setVoiceState] = useState<VoiceState>('IDLE')
  const [interimText, setInterimText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<Settings>({ rate: 1.0, muted: false, lang: 'en-US' })

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const processedRef = useRef<string>('')
  const lastTwinTextRef = useRef<string>('')

  const lastUser = useMemo(
    () => [...transcript].reverse().find(e => e.role === 'user') ?? null,
    [transcript]
  )
  const lastTwin = useMemo(
    () => [...transcript].reverse().find(e => e.role === 'twin') ?? null,
    [transcript]
  )

  // ── Stop TTS ──────────────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel()
    setVoiceState('IDLE')
  }, [])

  // ── Speak response ────────────────────────────────────────────────────────
  const speakText = useCallback((text: string) => {
    if (settings.muted || !window.speechSynthesis) {
      setVoiceState('IDLE')
      return
    }
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = settings.rate
    utt.lang = settings.lang

    // Pick a good voice if available
    const voices = window.speechSynthesis.getVoices()
    const preferred = voices.find(v =>
      v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural'))
    ) ?? voices.find(v => v.lang.startsWith('en')) ?? null
    if (preferred) utt.voice = preferred

    utt.onstart = () => setVoiceState('SPEAKING')
    utt.onend = () => setVoiceState('IDLE')
    utt.onerror = () => setVoiceState('IDLE')
    utteranceRef.current = utt
    setVoiceState('SPEAKING')
    window.speechSynthesis.speak(utt)
  }, [settings.muted, settings.rate, settings.lang])

  // ── Generate & speak AI response ──────────────────────────────────────────
  const handleUserInput = useCallback(async (userText: string) => {
    if (!userText.trim() || userText === processedRef.current) return
    processedRef.current = userText

    const userEntry: TranscriptEntry = {
      id: uid(), role: 'user', text: userText.trim(), timestamp: new Date()
    }
    setTranscript(prev => [...prev, userEntry])
    setVoiceState('PROCESSING')

    const history: ConversationTurn[] = transcript.map(e => ({
      role: e.role === 'user' ? 'user' : 'twin',
      text: e.text,
      timestamp: e.timestamp
    }))

    try {
      const response = await generateResponse(userText, history)
      lastTwinTextRef.current = response
      const twinEntry: TranscriptEntry = {
        id: uid(), role: 'twin', text: response, timestamp: new Date()
      }
      setTranscript(prev => [...prev, twinEntry])
      // Small natural pause before speaking
      setTimeout(() => speakText(response), 300)
    } catch {
      setErrorMsg('Failed to generate response. Please try again.')
      setVoiceState('ERROR')
    }
  }, [transcript, speakText])

  // ── Speech recognition ────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) {
      setErrorMsg('Your browser does not support speech recognition. Try Chrome or Edge.')
      setVoiceState('ERROR')
      return
    }

    stopSpeaking()
    processedRef.current = ''

    const rec: SpeechRecognition = new SR()
    rec.lang = settings.lang
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setVoiceState('LISTENING')
      setInterimText('')
    }

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      if (interim) setInterimText(interim)
      if (final) {
        setInterimText('')
        handleUserInput(final)
      }
    }

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        setErrorMsg('Microphone access was denied. Please allow microphone permissions and try again.')
      } else if (event.error === 'no-speech') {
        setVoiceState('IDLE')
        return
      } else {
        setErrorMsg(`Speech recognition error: ${event.error}. Please try again.`)
      }
      setVoiceState('ERROR')
    }

    rec.onend = () => {
      if (voiceState === 'LISTENING') {
        setVoiceState('IDLE')
        setInterimText('')
      }
    }

    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      setErrorMsg('Could not start microphone. Please check your browser permissions.')
      setVoiceState('ERROR')
    }
  }, [settings.lang, stopSpeaking, handleUserInput, voiceState])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setVoiceState('IDLE')
    setInterimText('')
  }, [])

  const handleMicClick = useCallback(() => {
    if (voiceState === 'LISTENING') {
      stopListening()
    } else if (voiceState === 'IDLE' || voiceState === 'ERROR') {
      setErrorMsg('')
      startListening()
    }
  }, [voiceState, startListening, stopListening])

  const replayLast = useCallback(() => {
    if (lastTwinTextRef.current) speakText(lastTwinTextRef.current)
  }, [speakText])

  const toggleMute = useCallback(() => {
    setSettings(s => {
      const next = { ...s, muted: !s.muted }
      if (!next.muted && voiceState === 'SPEAKING') stopSpeaking()
      return next
    })
  }, [voiceState, stopSpeaking])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      window.speechSynthesis?.cancel()
    }
  }, [])

  // ── Label map ────────────────────────────────────────────────────────────
  const stateLabel: Record<VoiceState, string> = {
    IDLE: 'Tap to speak',
    LISTENING: "I'm listening...",
    PROCESSING: 'Understanding your words...',
    SPEAKING: 'Aarav is speaking...',
    ERROR: 'Something went wrong',
  }

  return (
    <div className="nt-root">
      {/* Header */}
      <div className="nt-header">
        <div className="nt-header-info">
          <div className="nt-status-dot" />
          <div>
            <p className="nt-badge-label">Neural clone online</p>
            <h2 className="nt-title">Aarav AI Twin <span className="nt-version">v3.4</span></h2>
            <p className="nt-meta">98.4% DNA fidelity · trained on 48 long and 142 short form cuts</p>
          </div>
        </div>
        <div className="nt-header-actions">
          <button
            className={`nt-action-btn ${settings.muted ? 'nt-action-active' : ''}`}
            onClick={toggleMute}
            title={settings.muted ? 'Unmute' : 'Mute'}
          >
            {settings.muted ? '🔇' : '🔊'}
          </button>
          <button className="nt-action-btn" onClick={() => setShowSettings(s => !s)} title="Settings">⚙️</button>
          <button className="nt-action-btn" onClick={() => setShowHistory(true)} title="History">📜</button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Orb + waveform area */}
      <div className="nt-orb-area">
        <Orb state={voiceState} />
        <Waveform state={voiceState} />
        <p className="nt-state-label">{stateLabel[voiceState]}</p>
      </div>

      {/* Caption area */}
      <CaptionArea
        state={voiceState}
        interimText={interimText}
        lastUser={lastUser}
        lastTwin={lastTwin}
      />

      {/* Error message */}
      {voiceState === 'ERROR' && (
        <div className="nt-error">
          <span>⚠ {errorMsg}</span>
          <button
            className="nt-retry-btn"
            onClick={() => { setErrorMsg(''); setVoiceState('IDLE') }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Mic + control bar */}
      <div className="nt-controls">
        <div className="nt-side-controls">
          {lastTwin && voiceState !== 'SPEAKING' && (
            <button
              className="nt-ctrl-btn"
              onClick={replayLast}
              title="Replay response"
              aria-label="Replay last response"
            >
              ↩
            </button>
          )}
        </div>

        <button
          className={`nt-mic-btn nt-mic-${voiceState.toLowerCase()}`}
          onClick={handleMicClick}
          disabled={voiceState === 'PROCESSING' || voiceState === 'SPEAKING'}
          aria-label={voiceState === 'LISTENING' ? 'Stop listening' : 'Start listening'}
          id="neural-twin-mic-btn"
        >
          <span className="nt-mic-icon">
            {voiceState === 'LISTENING' ? (
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect x="10" y="4" width="8" height="16" rx="4" fill="currentColor" />
                <path d="M6 14a8 8 0 0016 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
                <line x1="14" y1="22" x2="14" y2="26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                {/* Stop indicator */}
                <rect x="4" y="4" width="20" height="20" rx="4" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4"/>
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect x="10" y="4" width="8" height="16" rx="4" fill="currentColor" />
                <path d="M6 14a8 8 0 0016 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
                <line x1="14" y1="22" x2="14" y2="26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="10" y1="26" x2="18" y2="26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            )}
          </span>
          {voiceState === 'PROCESSING' && <div className="nt-mic-spinner" />}
        </button>

        <div className="nt-side-controls">
          {voiceState === 'SPEAKING' && (
            <button
              className="nt-ctrl-btn nt-ctrl-stop"
              onClick={stopSpeaking}
              title="Stop speaking"
              aria-label="Stop AI speaking"
            >
              ■
            </button>
          )}
        </div>
      </div>

      {/* Transcript count hint */}
      {transcript.length > 0 && (
        <p className="nt-transcript-hint" onClick={() => setShowHistory(true)}>
          {Math.ceil(transcript.length / 2)} exchange{transcript.length > 2 ? 's' : ''} · tap to view history
        </p>
      )}

      {/* History modal */}
      {showHistory && (
        <HistoryModal entries={transcript} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
