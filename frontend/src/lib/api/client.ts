import createClient from 'openapi-fetch'
import type { paths } from './schema'
import { getTokenOrMemory } from '@/lib/auth'
import { getActiveWorkspace } from '@/lib/workspace'
import { ApiError, toApiError } from './errors'

/** API origin (no trailing slash, no /api/v1). Paths in the generated schema already include /api/v1. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '')

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null
/** AuthProvider registers itself here so any 401 signs the user out. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn
}

export const api = createClient<paths>({
  baseUrl: API_URL,
  // Do not read the token at module load; it changes on login/logout.
  fetch: async (input: Request) => {
    const token = getTokenOrMemory()
    if (token) input.headers.set('Authorization', `Bearer ${token}`)
    const workspace = getActiveWorkspace()
    if (workspace) input.headers.set('X-Workspace-Id', workspace)
    try {
      return await fetch(input)
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the API at ${API_URL}. Is it running? (make dev)`)
    }
  },
})

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Unwrap an openapi-fetch result: return `data` or throw a typed ApiError. */
export async function unwrap<T>(promise: Promise<Result<T>>, opts: { skipAuthRedirect?: boolean } = {}): Promise<T> {
  const { data, error, response } = await promise
  if (response.ok && error === undefined) return data as T
  const err = toApiError(response.status, error)
  if (response.status === 401 && !opts.skipAuthRedirect) onUnauthorized?.()
  throw err
}

/**
 * Backend media URLs are relative (`/media/<key>?exp=&sig=`). Prefix them with the API origin.
 * Absolute URLs pass through; null/undefined stay null.
 */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

/** Untyped escape hatch for endpoints missing from the schema (health, llm: open objects). */
export async function getJson<T>(path: string, opts: { auth?: boolean } = {}): Promise<T> {
  return requestJson<T>('GET', path, undefined, opts)
}
export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>('POST', path, body)
}

async function requestJson<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getTokenOrMemory()
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`
  const workspace = getActiveWorkspace()
  if (workspace && opts.auth !== false) headers['X-Workspace-Id'] = workspace
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the API at ${API_URL}. Is it running? (make dev)`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const err = toApiError(res.status, json)
    if (res.status === 401 && opts.auth !== false) onUnauthorized?.()
    throw err
  }
  return json as T
}

/** SSE/EventSource and <video> can not set headers: append the token as `?access_token=`. */
export function withAccessToken(path: string): string {
  const token = getTokenOrMemory()
  const url = `${API_URL}${path}`
  if (!token) return url
  const workspace = getActiveWorkspace()
  const extra = workspace ? `&workspace=${encodeURIComponent(workspace)}` : ''
  return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}${extra}`
}

/** Send a raw (non-JSON) body, e.g. an SRT/VTT/words.json transcript; the response is JSON. */
export async function putRaw<T>(path: string, body: BodyInit, contentType = 'application/octet-stream'): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': contentType }
  const token = getTokenOrMemory()
  if (token) headers.Authorization = `Bearer ${token}`
  const workspace = getActiveWorkspace()
  if (workspace) headers['X-Workspace-Id'] = workspace
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { method: 'PUT', headers, body })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the API at ${API_URL}. Is it running? (make dev)`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const err = toApiError(res.status, json)
    if (res.status === 401) onUnauthorized?.()
    throw err
  }
  return json as T
}

/** Fetch an authenticated file (CSV/MD export) and hand it to the browser as a download. */
export async function downloadAuthed(path: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {}
  const token = getTokenOrMemory()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { headers })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the API at ${API_URL}. Is it running? (make dev)`)
  }
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null))
  const cd = res.headers.get('content-disposition') ?? ''
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? fallbackName
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = decodeURIComponent(name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
