'use client'

import type { ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  eyebrow?: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'md' | 'sm'
  /** Block closing (while a request is in flight). */
  dismissible?: boolean
}

/** Accessible modal (focus trap, ESC, scroll lock, aria labelling via base-ui). */
export function Modal({ open, onOpenChange, title, eyebrow, description, children, footer, size = 'md', dismissible = true }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (dismissible || o) && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <div className="modal-wrap">
          <Dialog.Popup className={cn('modal', size === 'sm' && 'modal-sm')}>
            <div className="modal-head">
              <div>
                {eyebrow && <div className="eyebrow violet-text">{eyebrow}</div>}
                <Dialog.Title render={<h2 />}>{title}</Dialog.Title>
              </div>
              <Dialog.Close className="icon-button" aria-label="Close" disabled={!dismissible}>
                <X size={16} />
              </Dialog.Close>
            </div>
            {description && <Dialog.Description className="modal-desc">{description}</Dialog.Description>}
            {children && <div className="modal-body" style={description ? { marginTop: 14 } : undefined}>{children}</div>}
            {footer && <div className="modal-foot">{footer}</div>}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
