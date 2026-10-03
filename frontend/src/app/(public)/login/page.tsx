'use client'

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { AuthShell } from '@/components/auth/auth-shell'
import { GoogleButton } from '@/components/auth/google-button'
import { useAuth } from '@/components/auth-provider'
import { useHealth } from '@/lib/api/hooks'
import { isApiError } from '@/lib/api/errors'
import { homeFor } from '@/lib/auth'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next')
  const { status, profile, login } = useAuth()
  const health = useHealth({ refetchMs: 0 })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgot, setForgot] = useState(false)

  // Already signed in: skip the form.
  useEffect(() => {
    if (status === 'authed') router.replace(homeFor(profile, next))
  }, [status, profile, next, router])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const p = await login(email, password)
      router.replace(homeFor(p, next))
    } catch (err) {
      setError(
        isApiError(err) && err.code === 'INVALID_CREDENTIALS'
          ? 'That email and password do not match. Check them and try again.'
          : isApiError(err)
            ? err.message
            : 'Could not sign in.',
      )
      setBusy(false)
    }
  }

  const apiDown = health.isError

  return (
    <AuthShell title="Welcome to CreatorAI" subtitle="Sign in to your local workspace.">
      <form onSubmit={submit} className="auth-form" noValidate={false}>
        {apiDown && (
          <div className="auth-alert" role="alert">
            Can not reach the API. Start it with <code>make dev</code> and reload.
          </div>
        )}
        {error && (
          <div className="auth-alert" role="alert" data-testid="login-error">
            {error}
          </div>
        )}
        <label className="sr-only" htmlFor="email">
          Email address
        </label>
        <input id="email" name="email" type="email" autoComplete="username" className="pill-input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={!!error || undefined} autoFocus />
        <div style={{ position: 'relative' }}>
          <label className="sr-only" htmlFor="password">
            Password
          </label>
          <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" className="pill-input" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ paddingRight: 48 }} aria-invalid={!!error || undefined} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: 999, background: 'none', color: '#ffffff80', display: 'grid', placeItems: 'center' }}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button type="submit" className="pill-button" disabled={busy || status === 'authed'} data-testid="login-submit">
          {busy ? 'Signing in…' : 'Continue'} {!busy && <ArrowRight size={15} />}
        </button>
      </form>

      <div className="auth-divider">or</div>
      <GoogleButton />

      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <button type="button" onClick={() => setForgot((f) => !f)} style={{ background: 'none', color: '#9c988f', fontSize: 12.5 }} aria-expanded={forgot}>
          Forgot your password?
        </button>
        {forgot && (
          <p className="auth-alert info" style={{ marginTop: 10, textAlign: 'left' }}>
            CreatorAi runs on your machine, so there is no email reset. Your account lives in <code>data/creatorai.db</code>. If you cannot
            remember the password, run <code>make reset</code> to wipe the local database (this deletes your content) and sign up again.
          </p>
        )}
      </div>

      {health.data?.signup_open && (
        <p className="auth-switch">
          First time here?{' '}
          <Link href="/signup">Create your account</Link>
        </p>
      )}
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
