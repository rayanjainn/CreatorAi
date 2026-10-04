'use client'

import { useMe, useProjectMembers } from '@/lib/api/hooks'

export type Role = 'viewer' | 'editor' | 'admin' | 'owner'
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }

export const roleAtLeast = (role: Role | undefined, need: Role) => (role ? RANK[role] >= RANK[need] : false)

/**
 * The signed-in user's role in the workspace they are working in. The server enforces every permission; this only decides
 * what to show. While `me` is loading nothing is hidden (`known` is false), so controls do not flicker away and back.
 */
export function useRole() {
  const me = useMe(true).data
  const role = me?.role as Role | undefined
  return {
    role,
    known: !!role,
    /** May create and change content in this workspace. */
    canEdit: !role || roleAtLeast(role, 'editor'),
    /** May manage the team, the profile and integrations. */
    canAdmin: !!role && roleAtLeast(role, 'admin'),
    isOwner: role === 'owner',
    readOnly: !!role && !roleAtLeast(role, 'editor'),
  }
}

/** Your effective role on one project: a project override can raise or lower the workspace role. */
export function useProjectRole(itemId: string | undefined) {
  const ws = useRole()
  const members = useProjectMembers(itemId ?? '', !!itemId)
  const meId = useMe(true).data?.user.id
  const mine = members.data?.find((m) => m.user_id === meId)
  const role = (mine?.effective_role as Role | undefined) ?? ws.role
  return { role, canEdit: !role || roleAtLeast(role, 'editor'), readOnly: !!role && !roleAtLeast(role, 'editor') }
}
