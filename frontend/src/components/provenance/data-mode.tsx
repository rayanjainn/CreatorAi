'use client'

import Link from 'next/link'
import { AlertTriangle, KeyRound, Radio } from 'lucide-react'
import { useHealth } from '@/lib/api/hooks'
import type { DataMode, Health } from '@/lib/api/types'
import { Button, LinkButton } from '@/components/ui/button'
import { useUi } from '@/stores/ui'

export function activeProviders(h: Health | undefined): string[] {
  const flags = h?.features.llm.providers ?? {}
  const order = h?.features.llm.order ?? Object.keys(flags)
  return order.filter((p) => flags[p]?.configured)
}

export function useDataMode(): { mode: DataMode | undefined; providers: string[]; health: Health | undefined; isError: boolean } {
  const q = useHealth()
  return {
    mode: q.data?.data_mode,
    providers: activeProviders(q.data),
    health: q.data,
    isError: q.isError,
  }
}

const ENV_VARS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OLLAMA_API_KEY']

/** Global banner under the topbar: unconfigured -> setup card, mock -> loud warning. Real mode renders nothing here (see DataModeChip). */
export function DataModeBanner() {
  const { mode } = useDataMode()
  const dismissed = useUi((s) => s.setupDismissed)
  const dismiss = useUi((s) => s.dismissSetup)
  if (mode === 'mock') {
    return (
      <div className="mode-banner mock" role="alert" data-testid="mock-banner">
        <AlertTriangle size={16} style={{ flex: 'none' }} />
        <span>
          <b>MOCK MODE</b> — outputs are not real AI. Text carries a [MOCK] marker and is labelled as mock. Add a real key (
          <code className="env">GEMINI_API_KEY</code>, <code className="env">GROQ_API_KEY</code> or{' '}
          <code className="env">OLLAMA_API_KEY</code>) and set <code className="env">LLM_ALLOW_MOCK=false</code>.{' '}
          <Link href="/settings">Open settings</Link>
        </span>
      </div>
    )
  }
  if (mode === 'unconfigured' && !dismissed) {
    return (
      <div className="setup-card" data-testid="setup-card" role="status">
        <div className="stat-icon amber">
          <KeyRound size={17} />
        </div>
        <div>
          <h3>Add a free AI key to switch the AI features on</h3>
          <p>
            CreatorAi never fakes AI output. Until one provider is configured, the AI tools stay off and the rest of the app (board,
            library, matching) keeps working. Put one of these in <code className="env">.env</code>, then restart the API:
          </p>
          <ul>
            {ENV_VARS.map((v) => (
              <li key={v}>
                <code>{v}</code>
              </li>
            ))}
          </ul>
        </div>
        <div className="setup-actions">
          <LinkButton href="/settings#llm" variant="secondary" size="sm">
            Check my keys
          </LinkButton>
          <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Hide this notice for this session">
            Hide
          </Button>
        </div>
      </div>
    )
  }
  return null
}

/** Compact status chip for the topbar / sidebar. */
export function DataModeChip({ className }: { className?: string }) {
  const { mode, providers, isError } = useDataMode()
  if (isError && !mode) return null
  if (mode === 'real') {
    return (
      <Link href="/settings" className={`live-chip ${className ?? ''}`} data-testid="live-chip" title="AI provider status">
        <Radio size={12} />
        Live AI: {providers.join(', ') || 'ready'}
      </Link>
    )
  }
  if (mode === 'mock') {
    return (
      <Link href="/settings" className={`live-chip mock ${className ?? ''}`} data-testid="mock-chip">
        <AlertTriangle size={12} />
        Mock mode
      </Link>
    )
  }
  if (mode === 'unconfigured') {
    return (
      <Link href="/settings" className={`live-chip warn ${className ?? ''}`} data-testid="unconfigured-chip">
        <KeyRound size={12} />
        AI not set up
      </Link>
    )
  }
  return null
}
