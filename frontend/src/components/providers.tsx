'use client'

import { useState, type ReactNode } from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Tooltip } from '@base-ui/react/tooltip'
import { AuthProvider } from '@/components/auth-provider'
import { ToastViewport } from '@/components/common/toast-viewport'
import { handleApiError } from '@/lib/api/error-toasts'
import { isApiError } from '@/lib/api/errors'

type Meta = { silent?: boolean; silentCodes?: string[] } | undefined

function makeClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        const meta = query.meta as Meta
        if (meta?.silent) return
        // Background reads only surface the LLM/network class of errors; pages render their own error states.
        if (isApiError(err) && ['LLM_BUSY', 'LLM_NOT_CONFIGURED', 'QUOTA_EXCEEDED'].includes(err.code)) handleApiError(err)
      },
    }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        const meta = mutation.meta as Meta
        if (meta?.silent) return
        handleApiError(err, { silentCodes: meta?.silentCodes })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(isApiError(err) && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  })
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient)
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider delay={250}>
        <AuthProvider>{children}</AuthProvider>
        <ToastViewport />
      </Tooltip.Provider>
    </QueryClientProvider>
  )
}
