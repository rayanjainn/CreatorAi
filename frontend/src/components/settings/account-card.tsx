'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, KeyRound, LogOut, MonitorSmartphone, Trash2 } from 'lucide-react'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { downloadAuthed, postJson } from '@/lib/api/client'
import { errorMessage } from '@/lib/api/errors'
import { setToken } from '@/lib/auth'
import { toast } from '@/stores/toasts'

type NewToken = { access_token: string }

/** Password, sessions, export and wipe. The wipe is owner-only and needs the word DELETE. */
export function AccountCard({ email, workspaceName, isOwner, onSignOut }: { email?: string; workspaceName?: string; isOwner: boolean; onSignOut: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [typed, setTyped] = useState('')
  const router = useRouter()
  const qc = useQueryClient()

  const change = useMutation({
    mutationFn: () => postJson<NewToken>('/api/v1/auth/password', { current_password: current, new_password: next }),
    onSuccess: (out) => {
      setToken(out.access_token)
      setCurrent('')
      setNext('')
      toast.success('Password changed', 'Every other session was signed out.')
    },
  })
  const everywhere = useMutation({
    mutationFn: () => postJson<NewToken>('/api/v1/auth/sign-out-everywhere'),
    onSuccess: (out) => {
      setToken(out.access_token)
      toast.success('Signed out everywhere else', 'Only this browser is still signed in.')
    },
  })
  const exporter = useMutation({ mutationFn: () => downloadAuthed('/api/v1/workspace/export', 'creatorai-export.json') })
  const wipe = useMutation({
    mutationFn: () => postJson<Record<string, number>>('/api/v1/workspace/wipe', { confirm: typed }),
    onSuccess: () => {
      setConfirmWipe(false)
      setTyped('')
      qc.clear()
      toast.success('Workspace wiped', 'Every project and file was deleted.')
      router.push('/dashboard')
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (current && next.length >= 8) change.mutate()
  }

  return (
    <section className="card danger-zone span-2" aria-labelledby="dz-h" data-testid="account-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow" style={{ color: '#fca5a5' }}>
            Account
          </div>
          <h2 id="dz-h">Security & data</h2>
        </div>
      </div>
      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>Signed in as</dt>
        <dd>{email}</dd>
        <dt>Workspace</dt>
        <dd>{workspaceName}</dd>
        <dt>Your data</dt>
        <dd>
          Stored only on this machine (<code className="env">data/</code>). Export it as JSON at any time.
        </dd>
      </dl>

      <form onSubmit={submit} className="acct-form" data-testid="password-form">
        <Field label="Current password" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" htmlFor="pw-new" hint="At least 8 characters" error={next && next.length < 8 ? 'At least 8 characters' : null}>
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" loading={change.isPending} disabled={!current || next.length < 8} data-testid="password-save">
          <KeyRound size={14} /> Change password
        </Button>
      </form>
      {change.error && (
        <p className="field-error" role="alert">
          {errorMessage(change.error)}
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <LinkButton href="/onboarding?redo=1" variant="secondary">
          Re-run onboarding
        </LinkButton>
        <Button variant="secondary" onClick={() => exporter.mutate()} loading={exporter.isPending} data-testid="export-data">
          <Download size={14} /> Export my data
        </Button>
        <Button variant="secondary" onClick={() => everywhere.mutate()} loading={everywhere.isPending}>
          <MonitorSmartphone size={14} /> Sign out other sessions
        </Button>
        <Button variant="danger" onClick={onSignOut} data-testid="signout">
          <LogOut size={14} /> Sign out
        </Button>
        {isOwner && (
          <Button variant="ghost" onClick={() => setConfirmWipe(true)} data-testid="wipe-data">
            <Trash2 size={14} /> Wipe all projects and media
          </Button>
        )}
      </div>
      {(exporter.error || everywhere.error) && <p className="field-error">{errorMessage(exporter.error ?? everywhere.error)}</p>}

      <ConfirmDialog
        open={confirmWipe}
        onOpenChange={(o) => {
          setConfirmWipe(o)
          if (!o) setTyped('')
        }}
        title="Wipe every project and file?"
        description="Projects, scripts, footage, clips, renders, deals, research and Twin memories are deleted from this machine. Your account, team, settings and YouTube connection stay. Export first if you might need any of it."
        confirmLabel="Wipe everything"
        danger
        loading={wipe.isPending}
        onConfirm={() => typed === 'DELETE' && wipe.mutate()}
      >
        <Field label='Type DELETE to confirm' htmlFor="wipe-confirm" error={wipe.error ? errorMessage(wipe.error) : null}>
          <Input id="wipe-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="wipe-confirm" />
        </Field>
      </ConfirmDialog>
    </section>
  )
}
