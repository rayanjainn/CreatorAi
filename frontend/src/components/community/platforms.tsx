'use client'

import { cn } from '@/lib/utils'
import type { CommunityPlatform } from '@/lib/api/types'

export const PLATFORMS: { id: CommunityPlatform; label: string; short: string }[] = [
  { id: 'youtube', label: 'YouTube Shorts', short: 'YouTube' },
  { id: 'instagram', label: 'Instagram Reels', short: 'Instagram' },
  { id: 'tiktok', label: 'TikTok', short: 'TikTok' },
]

const label = (id: string) => PLATFORMS.find((p) => p.id === id)?.short ?? id

/** "Made for" chips on a post. */
export function PlatformBadges({ platforms }: { platforms: CommunityPlatform[] }) {
  if (!platforms.length) return null
  return (
    <span className="cp-platforms" aria-label="Made for">
      {platforms.map((p) => (
        <span key={p} className={cn('cp-platform', `cp-${p}`)} data-platform={p}>
          {label(p)}
        </span>
      ))}
    </span>
  )
}

/** Toggle chips to pick the target platforms. */
export function PlatformPicker({ value, onChange }: { value: CommunityPlatform[]; onChange: (v: CommunityPlatform[]) => void }) {
  return (
    <div className="cp-picker" role="group" aria-label="Made for">
      {PLATFORMS.map((p) => {
        const on = value.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            className={cn('cp-platform', `cp-${p.id}`, on && 'on')}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            data-testid={`platform-${p.id}`}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
