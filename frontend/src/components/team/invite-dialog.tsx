'use client'

import { useState } from 'react'
import { Check, Link2, Send } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { CopyButton } from '@/components/common/copy-button'
import { isApiError } from '@/lib/api/errors'
import { useContentList, useCreateInvite } from '@/lib/api/hooks'
import { stripDemo } from '@/lib/format'
import { useRole } from '@/lib/use-role'
import { ROLE_HELP, ROLE_LABEL } from './role-info'
import type { Invite } from '@/lib/api/types'

type InviteRole = 'viewer' | 'editor' | 'admin'

/**
 * Invite someone by email. No email is sent: the dialog shows a link to share. Optionally give them a different role on one
 * project (for example a viewer in the workspace who can edit just this video).
 */
export function InviteDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId?: string }) {
  const { isOwner } = useRole()
  const create = useCreateInvite()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>(projectId ? 'viewer' : 'editor')
  const [project, setProject] = useState(projectId ?? '')
  const [projectRole, setProjectRole] = useState<'viewer' | 'editor'>('editor')
  const [made, setMade] = useState<Invite | null>(null)
  const items = useContentList({}).data
  const error = create.error && isApiError(create.error) ? create.error.message : null

  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setMade(null)
      setEmail('')
      create.reset()
    }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    create.mutate({ email, role, content_item_id: project || null, project_role: project ? projectRole : null }, { onSuccess: setMade })
  }

  return (
    <Modal open={open} onOpenChange={close} size="md" eyebrow="Team" title={made ? 'Invite ready to share' : 'Invite someone'} description={made ? undefined : 'They get a link. Nothing is emailed from your computer, so copy the link and send it yourself.'}>
      {made ? (
        <div className="invite-done" data-testid="invite-done">
          <p>
            <Check size={14} /> <b>{made.email}</b> can join as <b>{ROLE_LABEL[made.role]}</b>
            {made.project_title ? <> and {made.project_role === 'editor' ? 'edit' : 'view'} “{stripDemo(made.project_title)}”</> : null}. The link works for 7 days and only for that email address.
          </p>
          <div className="invite-link">
            <Link2 size={14} aria-hidden />
            <input readOnly value={made.link ?? ''} aria-label="Invite link" data-testid="invite-link" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={made.link ?? ''} label="Copy the invite link" />
          </div>
          <div className="modal-foot-inline">
            <Button variant="secondary" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form className="invite-form" onSubmit={submit}>
          <Field label="Email address" htmlFor="inv-email" error={error}>
            <Input id="inv-email" type="email" required autoFocus placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="invite-email" />
          </Field>
          <Field label="Role in this workspace" htmlFor="inv-role" hint={ROLE_HELP[role]}>
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as InviteRole)} data-testid="invite-role">
              <option value="viewer">{ROLE_LABEL.viewer}</option>
              <option value="editor">{ROLE_LABEL.editor}</option>
              {isOwner && <option value="admin">{ROLE_LABEL.admin}</option>}
            </Select>
          </Field>
          <details className="invite-project" open={!!projectId}>
            <summary>Give a different role on one project</summary>
            <div className="invite-project-body">
              <Field label="Project" htmlFor="inv-project">
                <Select id="inv-project" value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">No specific project</option>
                  {items?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {stripDemo(c.title)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role on that project" htmlFor="inv-prole">
                <Select id="inv-prole" value={projectRole} disabled={!project} onChange={(e) => setProjectRole(e.target.value as 'viewer' | 'editor')}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </Select>
              </Field>
            </div>
          </details>
          <div className="modal-foot-inline">
            <Button variant="ghost" type="button" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!email.trim()} data-testid="invite-submit">
              <Send size={14} /> Create invite link
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
