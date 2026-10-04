'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { AuthShell } from '@/components/auth/auth-shell'
import { GoogleButton } from '@/components/auth/google-button'
import { useAuth } from '@/components/auth-provider'
import { useHealth } from '@/lib/api/hooks'
import { isApiError } from '@/lib/api/errors'
import { homeFor } from '@/lib/auth'

export default function SignupPage() {
  const router = useRouter()
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get('invite')
    if (invite) router.replace(`/invite/${encodeURIComponent(invite)}`)
  }, [router])
  const { status, profile, signup } = useAuth()
  const health = useHealth({ refetchMs: 0 })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    if (status === 'authed') router.replace(homeFor(profile))
  }, [status, profile, router])

  const isClosed = closed || health.data?.signup_open === false

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const p = await signup(email, password, name.trim() || undefined)
      router.replace(homeFor(p))
    } catch (err) {
      if (isApiError(err) && err.code === 'SIGNUP_CLOSED') setClosed(true)
      else if (isApiError(err) && err.code === 'EMAIL_TAKEN') setError('That email is already registered. Sign in instead.')
      else if (isApiError(err) && err.code === 'VALIDATION_ERROR') setError('Use a valid email and a password of at least 8 characters.')
      else setError(isApiError(err) ? err.message : 'Could not create the account.')
      setBusy(false)
    }
  }

  if (isClosed) {
    return (
      <AuthShell title="Sign-up is closed" subtitle="This workspace already has an account.">
        <div className="auth-alert info" role="status" data-testid="signup-closed">
          CreatorAi is a single-creator, local-first app: sign-up is only open while no account exists on this machine. Sign in with the existing
          account instead.
        </div>
        <Link href="/login" className="pill-button" style={{ marginTop: 18, textDecoration: 'none' }}>
          Go to sign in <ArrowRight size={15} />
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create your account" subtitle="One account for this machine. Your data never leaves it.">
      <form onSubmit={submit} className="auth-form">
        {error && (
          <div className="auth-alert" role="alert">
            {error}
          </div>
        )}
        <label className="sr-only" htmlFor="name">
          Your name
        </label>
        <input id="name" type="text" autoComplete="name" className="pill-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        <label className="sr-only" htmlFor="email">
          Email address
        </label>
        <input id="email" type="email" autoComplete="username" className="pill-input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="sr-only" htmlFor="password">
          Password
        </label>
        <input id="password" type="password" autoComplete="new-password" className="pill-input" placeholder="Password (min. 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <button type="submit" className="pill-button" disabled={busy} data-testid="signup-submit">
          {busy ? 'Creating account…' : 'Continue'} {!busy && <ArrowRight size={15} />}
        </button>
      </form>
      <div className="auth-divider">or</div>
      <GoogleButton />
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthShell>
  )
}
