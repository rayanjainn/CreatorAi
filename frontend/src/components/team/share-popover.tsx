'use client'

import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Share2, UserPlus } from 'lucide-react'
import { Avatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { useProjectMembers, useSetProjectRole } from '@/lib/api/hooks'
import { useRole } from '@/lib/use-role'
import { InviteDialog } from './invite-dialog'
import { ROLE_LABEL } from './role-info'

/** "Share" in the project header: who can open this project and at what level, plus a project-only invite. */
export function SharePopover({ itemId }: { itemId: string }) {
  const { canAdmin } = useRole()
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState(false)
  const members = useProjectMembers(itemId, open)
  const set = useSetProjectRole(itemId)

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className="button button-secondary button-sm" data-testid="share-open" aria-label="Share this project">
          <Share2 size={13} /> Share
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 70 }}>
            <Popover.Popup className="popover share-popover" data-testid="share-popover">
              <div className="popover-head">
                <b>Who can open this project</b>
                <small>Workspace members inherit their workspace role. You can give one person a different role here.</small>
              </div>
              <ul className="share-list">
                {members.isPending && <li className="muted small">Loading…</li>}
                {members.data?.map((m) => (
                  <li key={m.user_id}>
                    <Avatar id={m.user_id} name={m.display_name} size="sm" />
                    <span className="share-who">
                      <b>{m.display_name}</b>
                      <small>{m.email}</small>
                    </span>
                    {canAdmin && m.workspace_role !== 'owner' && m.workspace_role !== 'admin' ? (
                      <Select
                        aria-label={`Role of ${m.display_name} on this project`}
                        value={m.project_role ?? ''}
                        onChange={(e) => set.mutate({ userId: m.user_id, role: (e.target.value || null) as 'viewer' | 'editor' | null })}
                      >
                        <option value="">Workspace role ({ROLE_LABEL[m.workspace_role]})</option>
                        <option value="editor">Editor on this project</option>
                        <option value="viewer">Viewer on this project</option>
                      </Select>
                    ) : (
                      <span className="team-badge">{ROLE_LABEL[m.effective_role]}</span>
                    )}
                  </li>
                ))}
              </ul>
              {canAdmin && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setOpen(false)
                    setInvite(true)
                  }}
                  data-testid="share-invite"
                >
                  <UserPlus size={13} /> Invite someone to this project
                </Button>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <InviteDialog open={invite} onOpenChange={setInvite} projectId={itemId} />
    </>
  )
}
