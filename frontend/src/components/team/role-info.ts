import type { Role } from '@/lib/use-role'

export const ROLE_LABEL: Record<Role, string> = { viewer: 'Viewer', editor: 'Editor', admin: 'Admin', owner: 'Owner' }

export const ROLE_HELP: Record<Role, string> = {
  viewer: 'Can look at everything and comment. Cannot change anything.',
  editor: 'Can create and change content: scripts, footage, clips, the editor, renders.',
  admin: 'Everything an editor can do, plus manage the team, the profile and integrations.',
  owner: 'Like an admin, and can also change admins and owners. A workspace always keeps at least one.',
}

/** Roles `actor` may hand out to others in the member list. */
export function assignableRoles(actor: Role | undefined): Role[] {
  if (actor === 'owner') return ['viewer', 'editor', 'admin', 'owner']
  if (actor === 'admin') return ['viewer', 'editor']
  return []
}

/** Whether `actor` may change or remove a member who currently has `target`. */
export function canManage(actor: Role | undefined, target: Role): boolean {
  if (actor === 'owner') return true
  if (actor === 'admin') return target === 'viewer' || target === 'editor'
  return false
}
