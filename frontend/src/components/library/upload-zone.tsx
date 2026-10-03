'use client'

import { useRef, useState, type DragEvent } from 'react'
import { UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Drag & drop target + file picker. Accepts any number of files; the backend decides what it can process. */
export function UploadZone({ onFiles, compact, title = 'Drop footage here', hint = 'Video, audio, images or text. Large files upload in chunks and resume if the connection drops.' }: { onFiles: (files: File[]) => void; compact?: boolean; title?: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={cn('dropzone', over && 'over', compact && 'compact')}
      data-testid="dropzone"
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        if (--depth.current <= 0) {
          depth.current = 0
          setOver(false)
        }
      }}
      onDrop={onDrop}
    >
      <div className="dz-icon">
        <UploadCloud size={compact ? 18 : 24} />
      </div>
      <div className="dz-copy">
        <b>{title}</b>
        <span>{hint}</span>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="upload-input"
        aria-label="Choose files to upload"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
      <Button variant={compact ? 'secondary' : 'primary'} size={compact ? 'sm' : 'md'} onClick={() => input.current?.click()} data-testid="browse-files">
        Browse files
      </Button>
    </div>
  )
}
