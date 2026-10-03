import { toast } from '@/stores/toasts'
import { ApiError, isApiError } from './errors'

/** Codes that always get a dedicated, friendly toast. */
export function handleApiError(err: unknown, opts: { silentCodes?: string[] } = {}): void {
  if (!isApiError(err)) {
    toast.error('Something went wrong', err instanceof Error ? err.message : undefined)
    return
  }
  if (opts.silentCodes?.includes(err.code)) return
  switch (err.code) {
    case 'LLM_BUSY': {
      const s = err.retryAfter
      toast.warning(
        'The AI provider is busy',
        s ? `Rate limit reached. Try again in about ${Math.ceil(s)}s.` : 'Rate limit reached. Try again shortly.',
      )
      return
    }
    case 'LLM_NOT_CONFIGURED':
      toast.error('No AI provider configured', 'Set GEMINI_API_KEY, GROQ_API_KEY or OLLAMA_API_KEY and restart the API.', {
        label: 'Open settings',
        href: '/settings',
      })
      return
    case 'QUOTA_EXCEEDED':
      toast.warning('Quota reached', err.message)
      return
    case 'NO_YOUTUBE_CONNECTION':
      toast.warning('YouTube is not connected', 'YouTube publishing is not available in this build yet.')
      return
    case 'REVISION_CONFLICT':
      toast.warning('Changed elsewhere', 'This was updated in another tab. Reload to see the latest version.', {
        label: 'Reload',
        onClick: () => window.location.reload(),
      })
      return
    case 'UNAUTHORIZED':
      return // handled by the auth provider (redirect)
    case 'NETWORK_ERROR':
      toast.error('API unreachable', err.message)
      return
    default:
      toast.error(titleFor(err), err.message)
  }
}

function titleFor(err: ApiError): string {
  if (err.status >= 500) return 'Server error'
  if (err.code === 'VALIDATION_ERROR') return 'Check your input'
  if (err.code === 'NOT_FOUND') return 'Not found'
  return 'Request failed'
}
