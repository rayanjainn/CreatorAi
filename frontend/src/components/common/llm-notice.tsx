'use client'

import { useEffect, useState } from 'react'
import { Hourglass, KeyRound, RotateCw } from 'lucide-react'
import { Button, LinkButton } from '@/components/ui/button'
import { isApiError, isCode } from '@/lib/api/errors'

export const isLlmError = (e: unknown): boolean => isCode(e, 'LLM_NOT_CONFIGURED', 'LLM_BUSY')

const ENV_VARS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OLLAMA_API_KEY']

/**
 * Inline state for the two LLM failures (instead of only a toast): `LLM_NOT_CONFIGURED` lists the env vars to set,
 * `LLM_BUSY` counts down the server's `retry_after`. Renders nothing for any other error.
 */
export function LlmNotice({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const retryAfter = isApiError(error) ? error.retryAfter : null
  const [left, setLeft] = useState(retryAfter ? Math.ceil(retryAfter) : 0)
  const [seen, setSeen] = useState<unknown>(error)
  if (seen !== error) {
    setSeen(error)
    setLeft(retryAfter ? Math.ceil(retryAfter) : 0)
  }
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left])

  if (isCode(error, 'LLM_NOT_CONFIGURED')) {
    return (
      <div className={`notice notice-amber ${className ?? ''}`} role="alert" data-testid="llm-not-configured">
        <div className="stat-icon amber">
          <KeyRound size={16} />
        </div>
        <div className="notice-body">
          <b>No AI provider is configured</b>
          <p>
            This step needs a language model, and CreatorAi never fakes AI output. Set one of these in <code className="env">.env</code>, then restart the API:
          </p>
          <div className="chip-row" style={{ gap: 6 }}>
            {ENV_VARS.map((v) => (
              <code key={v} className="env">
                {v}
              </code>
            ))}
          </div>
          <p className="notice-fine">
            For offline development only, <code className="env">LLM_ALLOW_MOCK=true</code> enables a stand-in whose output is labelled MOCK.
          </p>
          <div className="notice-actions">
            <LinkButton href="/settings#llm" variant="secondary" size="sm">
              Check my keys
            </LinkButton>
          </div>
        </div>
      </div>
    )
  }
  if (isCode(error, 'LLM_BUSY')) {
    return (
      <div className={`notice notice-amber ${className ?? ''}`} role="alert" data-testid="llm-busy">
        <div className="stat-icon amber">
          <Hourglass size={16} />
        </div>
        <div className="notice-body">
          <b>The AI provider is busy</b>
          <p>Every configured provider is rate-limited or failing right now. Nothing was saved. {left > 0 ? `Try again in about ${left}s.` : 'You can try again.'}</p>
          {onRetry && (
            <div className="notice-actions">
              <Button variant="secondary" size="sm" onClick={onRetry} disabled={left > 0}>
                <RotateCw size={13} /> {left > 0 ? `Retry in ${left}s` : 'Retry now'}
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }
  return null
}
