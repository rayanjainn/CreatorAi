'use client'

import { useState } from 'react'
import { Clock, LogOut, Mail, Trash2, UserPlus, X } from 'lucide-react'
import { Avatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { CopyButton } from '@/components/common/copy-button'
import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/components/auth-provider'
import { useChangeMemberRole, useInvites, useMembers, useRemoveMember, useRenameWorkspace, useRevokeInvite, useWorkspaceInfo } from '@/lib/api/hooks'
import { relativeTime } from '@/lib/time'
import { useRole, type Role } from '@/lib/use-role'
import { InviteDialog } from './invite-dialog'
import { assignableRoles, canManage, ROLE_HELP, ROLE_LABEL } from './role-info'
import type { Member } from '@/lib/api/types'

/** Settings → Team: who is in this workspace, what they can do, and the invite links that are still open. */
export function TeamCard() {
  const { me, switchWorkspace } = useAuth()
  const { role, canAdmin } = useRole()
  const ws = useWorkspaceInfo()
  const members = useMembers()
  const invites = useInvites(canAdmin)
  const change = useChangeMemberRole()
  const remove = useRemoveMember()
  const revoke = useRevokeInvite()
  const rename = useRenameWorkspace()
  const [invite, setInvite] = useState(false)
  const [leaving, setLeaving] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [name, setName] = useState<string | null>(null)
  const isHome = me?.workspaces?.find((w) => w.id === me.workspace_id)?.is_home ?? true

  return (
    <section className="card span-2 team-card" id="team" aria-labelledby="team-h" data-testid="team-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow">Collaboration</div>
          <h2 id="team-h">Team</h2>
        </div>
        {canAdmin && (
          <Button onClick={() => setInvite(true)} data-testid="invite-open">
            <UserPlus size={15} /> Invite someone
          </Button>
        )}
      </div>

      <div className="team-ws">
        {canAdmin ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name && name.trim() && name !== ws.data?.name) rename.mutate(name.trim(), { onSuccess: () => setName(null) })
            }}
          >
            <label htmlFor="ws-name">Workspace name</label>
            <div className="team-ws-row">
              <Input id="ws-name" value={name ?? ws.data?.name ?? ''} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="secondary" size="sm" loading={rename.isPending} disabled={!name || name === ws.data?.name}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className="muted small">
            You are a <b>{role ? ROLE_LABEL[role] : '…'}</b> in <b>{ws.data?.name ?? '…'}</b>. {role ? ROLE_HELP[role] : ''}
          </p>
        )}
      </div>

      {members.isPending ? (
        <Skeleton style={{ height: 120 }} />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : (
        <ul className="team-list" data-testid="team-members">
          {members.data.map((m) => {
            const options = assignableRoles(role)
            const editable = canAdmin && !m.is_me && canManage(role, m.role as Role)
            return (
              <li key={m.user_id} data-testid="team-member" data-role={m.role}>
                <Avatar id={m.user_id} name={m.display_name} />
                <div className="team-who">
                  <b>
                    {m.display_name} {m.is_me && <span className="team-you">You</span>}
                  </b>
                  <small>{m.email}</small>
                </div>
                {editable ? (
                  <Select
                    aria-label={`Role of ${m.display_name}`}
                    value={m.role}
                    className="team-role"
                    onChange={(e) => change.mutate({ userId: m.user_id, role: e.target.value as Member['role'] })}
                    data-testid="member-role"
                  >
                    {options.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className={`team-badge role-${m.role}`} title={ROLE_HELP[m.role as Role]}>
                    {ROLE_LABEL[m.role as Role]}
                  </span>
                )}
                {editable && (
                  <button type="button" className="icon-button" aria-label={`Remove ${m.display_name}`} title="Remove from the workspace" onClick={() => setRemoving(m)} data-testid="member-remove">
                    <Trash2 size={14} />
                  </button>
                )}
                {m.is_me && !isHome && (
                  <button type="button" className="icon-button" aria-label="Leave this workspace" title="Leave this workspace" onClick={() => setLeaving(m)} data-testid="member-leave">
                    <LogOut size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canAdmin && (
        <div className="team-invites">
          <h3>Open invites</h3>
          {invites.isPending ? (
            <Skeleton style={{ height: 52 }} />
          ) : invites.data?.length ? (
            <ul className="team-list" data-testid="team-invites">
              {invites.data.map((i) => (
                <li key={i.id} data-status={i.status}>
                  <span className="team-mail">
                    <Mail size={15} />
                  </span>
                  <div className="team-who">
                    <b>{i.email}</b>
                    <small>
                      {ROLE_LABEL[i.role]}
                      {i.project_title ? ` · ${i.project_role} on “${i.project_title.replace(/^\[DEMO\]\s*/i, '')}”` : ''} · {i.status === 'expired' ? 'expired' : `expires ${relativeTime(i.expires_at)}`}
                    </small>
                  </div>
                  {i.link && i.status === 'pending' && <CopyButton text={i.link} label={`Copy the invite link for ${i.email}`} />}
                  <button type="button" className="icon-button" aria-label={`Revoke the invite for ${i.email}`} title="Revoke" onClick={() => revoke.mutate(i.id)}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              <Clock size={12} /> No open invites. Invite links work for 7 days.
            </p>
          )}
        </div>
      )}

      <InviteDialog open={invite} onOpenChange={setInvite} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.display_name ?? ''}?`}
        description="They lose access to this workspace right away. Their comments and history stay."
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (removing) remove.mutate(removing.user_id)
          setRemoving(null)
        }}
      />
      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(o) => !o && setLeaving(null)}
        title="Leave this workspace?"
        description="You will go back to your own workspace. An admin can invite you again."
        confirmLabel="Leave"
        danger
        onConfirm={() => {
          if (leaving) remove.mutate(leaving.user_id, { onSuccess: () => switchWorkspace(null) })
          setLeaving(null)
        }}
      />
    </section>
  )

}
