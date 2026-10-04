import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'

const PALETTE = ['#8b5cf6', '#38bdf8', '#f59e0b', '#ec4899', '#14b8a6', '#22c55e', '#f97316', '#6366f1']

/** A stable colour per person, so the same collaborator looks the same everywhere. */
export function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function Avatar({ id, name, size = 'md', className, title }: { id: string; name: string; size?: 'sm' | 'md' | 'lg'; className?: string; title?: string }) {
  return (
    <span className={cn('avatar-chip', `avatar-${size}`, className)} style={{ ['--av' as string]: colorFor(id) }} title={title ?? name} aria-label={name}>
      {initials(name)}
    </span>
  )
}

/** Overlapping avatars of people who are here right now, with a "+n" for the rest. */
export function AvatarStack({ people, max = 4 }: { people: { id: string; name: string; hint?: string }[]; max?: number }) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span className="avatar-stack" aria-label={`${people.length} other ${people.length === 1 ? 'person is' : 'people are'} here`}>
      {shown.map((p) => (
        <Avatar key={p.id} id={p.id} name={p.name} size="sm" title={p.hint ? `${p.name} · ${p.hint}` : p.name} />
      ))}
      {rest > 0 && <span className="avatar-chip avatar-sm avatar-more">+{rest}</span>}
    </span>
  )
}
