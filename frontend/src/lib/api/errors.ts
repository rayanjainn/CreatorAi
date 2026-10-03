import type { ApiErrorBody } from './types'

/** Typed error for every non-2xx response. `code` is the backend's stable machine code. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Seconds to wait before retrying (LLM_BUSY), if the server said so. */
  get retryAfter(): number | null {
    const v = this.details.retry_after
    return typeof v === 'number' ? v : null
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

export function isCode(e: unknown, ...codes: string[]): e is ApiError {
  return isApiError(e) && codes.includes(e.code)
}

/** Parse the backend's `{error:{code,message,details}}` (and FastAPI's default 422 shape) into an ApiError. */
export function toApiError(status: number, body: unknown): ApiError {
  const b = body as Partial<ApiErrorBody> | { detail?: unknown } | null
  if (b && typeof b === 'object' && 'error' in b && b.error) {
    const e = b.error
    return new ApiError(status, e.code ?? 'UNKNOWN', e.message ?? 'Request failed', e.details ?? {})
  }
  if (b && typeof b === 'object' && 'detail' in b && b.detail !== undefined) {
    return new ApiError(status, 'VALIDATION_ERROR', 'Request validation failed', { detail: b.detail })
  }
  return new ApiError(status, status === 0 ? 'NETWORK_ERROR' : 'HTTP_ERROR', `Request failed (${status})`)
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message
  if (e instanceof Error) return e.message
  return 'Something went wrong'
}
