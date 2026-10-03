'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/lib/api/hooks'
import { useEditor } from '@/stores/editor'
import { refreshAssets, startAutosave } from './controller'
import { fetchEdit } from './api'

const URL_REFRESH_MS = 40 * 60_000

/** Load `GET /clips/{id}/edit` into the editor store once, run the autosaver and keep signed media URLs fresh. */
export function useEditorBootstrap(clipId: string, enabled: boolean) {
  const loadedFor = useEditor((s) => (s.loaded ? s.clipId : null))
  const query = useQuery({
    queryKey: qk.edit(clipId),
    queryFn: () => fetchEdit(clipId),
    enabled: enabled && loadedFor !== clipId,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (query.data && useEditor.getState().clipId !== clipId) useEditor.getState().load(query.data)
  }, [query.data, clipId])

  useEffect(() => {
    // a different clip (or leaving) always starts clean
    const s = useEditor.getState()
    if (s.clipId && s.clipId !== clipId) s.reset()
    return () => useEditor.getState().reset()
  }, [clipId])

  useEffect(() => {
    if (!enabled) return
    const stop = startAutosave()
    const id = setInterval(() => void refreshAssets(), URL_REFRESH_MS)
    return () => {
      stop()
      clearInterval(id)
    }
  }, [enabled])

  return { query, ready: loadedFor === clipId }
}
