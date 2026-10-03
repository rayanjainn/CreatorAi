'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/** Deep-link state of the asset drawer: `?asset=<id>&t=<seconds>`. Other query params are preserved. */
export function useAssetDrawer() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const assetId = params.get('asset')
  const tRaw = params.get('t')
  const t = tRaw !== null && Number.isFinite(Number(tRaw)) ? Number(tRaw) : undefined

  const set = useCallback(
    (id: string | null, at?: number) => {
      const next = new URLSearchParams(params.toString())
      if (id) next.set('asset', id)
      else next.delete('asset')
      if (id && at !== undefined) next.set('t', String(Math.round(at * 10) / 10))
      else next.delete('t')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  return { assetId, t, open: (id: string, at?: number) => set(id, at), close: () => set(null) }
}
