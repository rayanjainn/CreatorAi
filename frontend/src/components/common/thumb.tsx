'use client'

import { useState } from 'react'
import { Film } from 'lucide-react'
import { mediaUrl } from '@/lib/api/client'

/** Thumbnail from a signed `/media/...` URL; gradient + icon when absent or broken (signed URLs expire after 1 h). */
export function Thumb({ src, alt = '', className = 'thumb', children, iconSize = 26 }: { src: string | null | undefined; alt?: string; className?: string; children?: React.ReactNode; iconSize?: number }) {
  const url = mediaUrl(src)
  const [failed, setFailed] = useState<string | null>(null)
  const ok = url && failed !== url
  return (
    <div className={className}>
      {ok ? <img src={url} alt={alt} loading="lazy" onError={() => setFailed(url)} /> : <Film size={iconSize} aria-hidden />}
      {children}
    </div>
  )
}
