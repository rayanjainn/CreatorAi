'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { api, setUnauthorizedHandler, unwrap } from '@/lib/api/client'
import { qk, useMe } from '@/lib/api/hooks'
import type { Me, Profile, TokenOut } from '@/lib/api/types'
import type { ApiError } from '@/lib/api/errors'
import { clearToken, getToken, markSignedOut, setToken, subscribeToken } from '@/lib/auth'
import { setActiveWorkspace } from '@/lib/workspace'

type AuthStatus = 'loading' | 'authed' | 'anon' | 'error'

type AuthContextValue = {
  status: AuthStatus
  me: Me | undefined
  profile: Profile | undefined
  error: ApiError | null
  retry: () => void
  login: (email: string, password: string) => Promise<Profile>
  signup: (email: string, password: string, displayName?: string, inviteToken?: string) => Promise<Profile>
  logout: () => void
  /** Work in another workspace you belong to (a full reload, so no data of the old one lingers). */
  switchWorkspace: (workspaceId: string | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const PUBLIC_PREFIXES = ['/login', '/signup', '/invite']

function acceptToken(out: TokenOut, qc: ReturnType<typeof useQueryClient>): Profile {
  setToken(out.access_token)
  setActiveWorkspace(null) // a fresh sign-in starts in your own workspace
  const me: Me = { user: out.user, workspace_id: out.workspace_id, workspace_name: out.workspace_name, role: out.role, workspaces: out.workspaces, profile: out.profile }
  qc.setQueryData(qk.me, me)
  return out.profile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const router = useRouter()
  // undefined on the server / first render so markup is stable, then the real value.
  const token = useSyncExternalStore(subscribeToken, getToken, () => undefined)
  const meQuery = useMe(!!token)

  const logout = useCallback(() => {
    markSignedOut()
    clearToken()
    setActiveWorkspace(null)
    qc.clear()
    router.replace('/login')
  }, [qc, router])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken()
      qc.clear()
      const here = window.location.pathname
      if (!PUBLIC_PREFIXES.some((p) => here.startsWith(p)) && here !== '/') {
        router.replace(`/login?next=${encodeURIComponent(here + window.location.search)}`)
      }
    })
    return () => setUnauthorizedHandler(null)
  }, [qc, router])

  const value = useMemo<AuthContextValue>(() => {
    let status: AuthStatus
    if (token === undefined) status = 'loading'
    else if (!token) status = 'anon'
    else if (meQuery.data) status = 'authed'
    else if (meQuery.isError) status = 'error'
    else status = 'loading'
    return {
      status,
      me: token ? meQuery.data : undefined,
      profile: token ? meQuery.data?.profile : undefined,
      error: (meQuery.error as ApiError | null) ?? null,
      retry: () => void meQuery.refetch(),
      logout,
      login: async (email, password) =>
        acceptToken(await unwrap<TokenOut>(api.POST('/api/v1/auth/login', { body: { email, password } }), { skipAuthRedirect: true }), qc),
      signup: async (email, password, displayName, inviteToken) =>
        acceptToken(
          await unwrap<TokenOut>(
            api.POST('/api/v1/auth/signup', { body: { email, password, display_name: displayName || null, invite_token: inviteToken || null } }),
            { skipAuthRedirect: true },
          ),
          qc,
        ),
      switchWorkspace: (workspaceId) => {
        setActiveWorkspace(workspaceId)
        // A full reload on purpose: every cached query and open stream belongs to the previous workspace.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/dashboard')
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, meQuery.data, meQuery.isError, meQuery.error, logout, qc])

  // A 401 on /me means a stale token: sign out quietly.
  useEffect(() => {
    if (meQuery.error && (meQuery.error as ApiError).status === 401) {
      clearToken()
      qc.clear()
    }
  }, [meQuery.error, qc])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
