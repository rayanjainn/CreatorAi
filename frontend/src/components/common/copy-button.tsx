'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '@/lib/format'
import { toast } from '@/stores/toasts'

/** Icon button that copies `text` and confirms with a check mark. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={label}
      title={label}
      data-testid="copy"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } else toast.warning('Could not copy', 'Your browser blocked clipboard access. Select the text and copy it by hand.')
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}
