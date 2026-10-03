'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { useToasts, type ToastTone } from '@/stores/toasts'
import { Button, LinkButton } from '@/components/ui/button'

const ICONS: Record<ToastTone, typeof Info> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICONS[t.tone]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className={`toast ${t.tone}`}
              role={t.tone === 'error' ? 'alert' : 'status'}
            >
              <Icon size={17} />
              <div className="toast-body">
                <b>{t.title}</b>
                {t.description && <p>{t.description}</p>}
                {t.action && (
                  <div className="toast-actions">
                    {t.action.href ? (
                      <LinkButton href={t.action.href} variant="secondary" size="sm" onClick={() => dismiss(t.id)}>
                        {t.action.label}
                      </LinkButton>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          t.action?.onClick?.()
                          dismiss(t.id)
                        }}
                      >
                        {t.action.label}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <button className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

