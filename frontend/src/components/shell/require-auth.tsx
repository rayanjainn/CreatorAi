'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { Splash } from '@/components/common/splash'
import { ErrorState } from '@/components/common/error-state'
import { homeFor } from '@/lib/auth'

/**
 * Redirect rules (single source of truth):
 *   anonymous                      -> /login?next=<here>
 *   signed in, onboarding not done -> /onboarding
 *   signed in, on /onboarding but already onboarded (and no ?redo=1) -> /dashboard
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, profile, error, retry } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const params = useSearchParams()
  const onOnboarding = pathname === '/onboarding'
  const redo = params.get('redo') === '1'

  const target =
    status === 'anon'
      ? `/login?next=${encodeURIComponent(pathname)}`
      : status === 'authed' && profile && !profile.onboarding_done && !onOnboarding
        ? '/onboarding'
        : status === 'authed' && profile?.onboarding_done && onOnboarding && !redo
          ? homeFor(profile)
          : null

  useEffect(() => {
    if (target) router.replace(target)
  }, [target, router])

  if (status === 'error' && error?.status !== 401) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 520 }}>
          <ErrorState error={error} onRetry={retry} title="Could not reach CreatorAi" />
        </div>
      </div>
    )
  }
  if (status !== 'authed' || target) return <Splash />
  return <>{children}</>
}
