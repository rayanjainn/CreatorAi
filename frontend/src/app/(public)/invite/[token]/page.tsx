'use client'

import { use, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AuthShell } from '@/components/auth/auth-shell'
import { useAuth } from '@/components/auth-provider'
import { useAcceptInvite, useInvitePreview } from '@/lib/api/hooks'
import { isApiError } from '@/lib/api/errors'
import { ROLE_HELP, ROLE_LABEL } from '@/components/team/role-info'
import type { Role } from '@/lib/use-role'
import { setActiveWorkspace } from '@/lib/workspace'

/** Public landing page for an invite link: shows what you are joining, then signs you up or in and accepts. */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const preview = useInvitePreview(token)
  const { status, me, signup, logout } = useAuth()
  const accept = useAcceptInvite()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inv = preview.data

  const enter = (workspaceId: string, itemId?: string | null) => {
    setActiveWorkspace(workspaceId)
    window.location.assign(itemId ? `/projects/${itemId}` : '/dashboard')
  }

  const acceptNow = () => {
    setError(null)
    accept.mutate(token, {
      onSuccess: (r) => enter(r.workspace_id, r.content_item_id),
      onError: (e) => setError(isApiError(e) ? e.message : 'Could not accept the invite.'),
    })
  }

  const join = async (e: FormEvent) => {
    e.preventDefault()
    if (!inv) return
    setBusy(true)
    setError(null)
    try {
      await signup(inv.email, password, name.trim() || undefined, token)
      // Signup already joined; accepting again is idempotent and tells us where to go.
      const r = await accept.mutateAsync(token)
      enter(r.workspace_id, r.content_item_id)
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not create the account.')
      setBusy(false)
    }
  }

  if (preview.isLoading) {
    return (
      <AuthShell title="Opening your invite…">
        <p className="auth-sub">One moment.</p>
      </AuthShell>
    )
  }
  if (preview.isError || !inv) {
    return (
      <AuthShell title="This invite link is not valid" subtitle="It may have been revoked or mistyped.">
        <div className="auth-alert" role="alert" data-testid="invite-invalid">
          Ask the person who invited you to send a new link.
        </div>
        <Link href="/login" className="pill-button" style={{ marginTop: 18, textDecoration: 'none' }}>
          Go to sign in <ArrowRight size={15} />
        </Link>
      </AuthShell>
    )
  }

  const who = inv.inviter_name ?? 'A teammate'
  const target = inv.project_title ? `the project “${inv.project_title}” in ${inv.workspace_name}` : inv.workspace_name
  const role = inv.project_role ?? inv.role
  const blocked = inv.status !== 'pending'
  const mismatch = status === 'authed' && me && me.user.email.toLowerCase() !== inv.email.toLowerCase()

  return (
    <AuthShell title={`Join ${inv.workspace_name}`} subtitle={`${who} invited you to ${target} as ${ROLE_LABEL[role as Role]}.`}>
      <div className="invite-card" data-testid="invite-card">
        <span>Invitation for</span>
        <b>{inv.email}</b>
        <small>{ROLE_HELP[role as Role]}</small>
      </div>
      {error && (
        <div className="auth-alert" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {blocked ? (
        <div className="auth-alert info" role="status" style={{ marginTop: 12 }}>
          {inv.status === 'expired' ? 'This invite has expired. Ask for a new one.' : 'This invite was already used.'}
        </div>
      ) : status === 'authed' && !mismatch ? (
        <button className="pill-button" style={{ marginTop: 18 }} onClick={acceptNow} disabled={accept.isPending} data-testid="invite-accept">
          {accept.isPending ? 'Joining…' : 'Accept and open'} <ArrowRight size={15} />
        </button>
      ) : mismatch ? (
        <>
          <div className="auth-alert" role="alert" style={{ marginTop: 12 }}>
            You are signed in as {me!.user.email}, but this invite is for {inv.email}.
          </div>
          <button className="pill-button" style={{ marginTop: 14 }} onClick={logout}>
            Sign out and switch account
          </button>
        </>
      ) : inv.account_exists ? (
        <Link
          href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
          className="pill-button"
          style={{ marginTop: 18, textDecoration: 'none' }}
          data-testid="invite-signin"
        >
          Sign in to accept <ArrowRight size={15} />
        </Link>
      ) : (
        <form onSubmit={join} className="auth-form" style={{ marginTop: 14 }}>
          <input className="pill-input" type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
          <input className="pill-input" type="email" value={inv.email} readOnly aria-label="Email address" />
          <input className="pill-input" type="password" placeholder="Choose a password (min. 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          <button type="submit" className="pill-button" disabled={busy} data-testid="invite-signup">
            {busy ? 'Creating account…' : 'Create account and join'} {!busy && <ArrowRight size={15} />}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
