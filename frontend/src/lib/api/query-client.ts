import type { QueryClient } from '@tanstack/react-query'

/**
 * The app's single QueryClient, registered by <Providers/>. Plain (non-React) modules such as the editor's media helpers use it
 * to read and invalidate cached data; components should keep using `useQueryClient()`.
 */
let current: QueryClient | null = null

export function setQueryClient(client: QueryClient): void {
  current = client
}

export const queryClient = {
  fetchQuery: ((...args: Parameters<QueryClient['fetchQuery']>) => requireClient().fetchQuery(...args)) as QueryClient['fetchQuery'],
  invalidateQueries: ((...args: Parameters<QueryClient['invalidateQueries']>) => requireClient().invalidateQueries(...args)) as QueryClient['invalidateQueries'],
}

function requireClient(): QueryClient {
  if (!current) throw new Error('The query client is not ready yet')
  return current
}
