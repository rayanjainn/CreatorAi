'use client'

import { Menu, MenuItem, MenuPopup } from '@/components/ui/menu'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { initials } from '@/lib/format'
import { ROLE_LABEL } from './role-info'

/** Sidebar header: the workspace you are in, your role there, and a menu to move to another one you belong to. */
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, switchWorkspace } = useAuth()
  const list = me?.workspaces ?? []
  const here = list.find((w) => w.id === me?.workspace_id)
  const name = me?.workspace_name || 'My workspace'
  const body = (
    <>
      <div className="avatar" aria-hidden>
        {initials(name)}
      </div>
      {!collapsed && (
        <div>
          <b>{name}</b>
          <small>{me?.role ? `${ROLE_LABEL[me.role as keyof typeof ROLE_LABEL]}${here?.is_home ? ' · yours' : ''}` : 'Local workspace'}</small>
        </div>
      )}
    </>
  )
  if (list.length < 2) {
    return (
      <div className="workspace-switcher" title={name} data-testid="workspace-switcher">
        {body}
      </div>
    )
  }
  return (
    <Menu.Root>
      <Menu.Trigger className="workspace-switcher workspace-switcher-btn" title={name} aria-label={`Workspace: ${name}. Switch workspace`} data-testid="workspace-switcher">
        {body}
        {!collapsed && <ChevronsUpDown size={14} aria-hidden style={{ color: '#9c988f', flex: 'none' }} />}
      </Menu.Trigger>
      <MenuPopup align="start" side="bottom">
        <div className="menu-head">Your workspaces</div>
        {list.map((w) => (
          <MenuItem key={w.id} onClick={() => w.id !== me?.workspace_id && switchWorkspace(w.is_home ? null : w.id)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
              <small style={{ color: '#9c988f' }}>{ROLE_LABEL[w.role]}</small>
              {w.id === me?.workspace_id && <Check size={14} aria-hidden />}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu.Root>
  )
}
