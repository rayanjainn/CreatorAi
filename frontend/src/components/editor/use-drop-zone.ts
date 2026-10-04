'use client'

import { useCallback, useRef, useState } from 'react'
import { isMediaDrag, readDrop, type MediaDrag } from '@/lib/editor/media'

type Handlers = {
  onAsset: (asset: MediaDrag, e: React.DragEvent) => void
  onFiles: (files: File[], e: React.DragEvent) => void
  disabled?: boolean
  /** Called on every dragover (for a live insertion marker). */
  onOver?: (e: React.DragEvent) => void
  /** Called when the drag leaves or ends without a drop. */
  onLeave?: () => void
}

/**
 * Drop target for library assets and files from the computer. Returns the props to spread on the element plus `over`, which is
 * true while something acceptable is dragged above it (the depth counter keeps it steady while crossing child elements).
 */
export function useDropZone({ onAsset, onFiles, disabled, onOver, onLeave }: Handlers) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const reset = useCallback(() => {
    depth.current = 0
    setOver(false)
  }, [])
  const props = {
    onDragEnter: (e: React.DragEvent) => {
      if (disabled || !isMediaDrag(e)) return
      e.preventDefault()
      depth.current += 1
      setOver(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (disabled || !isMediaDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      onOver?.(e)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (disabled || !isMediaDrag(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) {
        setOver(false)
        onLeave?.()
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (disabled || !isMediaDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      reset()
      onLeave?.()
      const { asset, files } = readDrop(e)
      if (asset) onAsset(asset, e)
      else if (files.length) onFiles(files, e)
    },
  }
  return { props, over }
}
