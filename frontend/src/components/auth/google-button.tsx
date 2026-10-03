'use client'

import { Tooltip } from '@/components/ui/tooltip'

/** Disabled in local mode (no OAuth); keeps the visual slot and explains why. */
export function GoogleButton() {
  return (
    <Tooltip content="Not available in local mode. CreatorAi signs in with email and password stored on this machine." side="bottom">
      <span tabIndex={0} style={{ display: 'block' }} aria-label="Continue with Google (not available in local mode)">
        <button type="button" className="pill-button outline" disabled aria-disabled="true" style={{ width: '100%', marginTop: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.5 3.5-5.35 3.5a5.9 5.9 0 1 1 0-11.8c1.5 0 2.8.5 3.8 1.5l2.1-2.1A8.9 8.9 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.6-3.6 8.6-8.8 0-.4 0-.8-.1-1.1Z" />
          </svg>
          Continue with Google
        </button>
      </span>
    </Tooltip>
  )
}
