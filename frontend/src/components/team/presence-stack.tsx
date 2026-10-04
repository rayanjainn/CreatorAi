'use client'

import { AvatarStack } from '@/components/common/avatar'
import { useAuth } from '@/components/auth-provider'
import { usePresence } from '@/lib/api/hooks'

const WHERE: Record<string, string> = { editor: 'in the editor', script: 'in the script', footage: 'in footage', match: 'in match', clips: 'in clips', plan: 'in the plan' }
const hint = (w: string) => WHERE[w.split(':')[0]] ?? 'here'

/** Heartbeats this project and shows the other people who have it open right now. */
export function PresenceStack({ itemId, where }: { itemId: string; where: string }) {
  const { me } = useAuth()
  const here = usePresence(itemId, where).data ?? []
  const others = here.filter((p) => p.user_id !== me?.user.id)
  return <AvatarStack people={others.map((p) => ({ id: p.user_id, name: p.name, hint: hint(p.where) }))} />
}
