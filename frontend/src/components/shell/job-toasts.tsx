'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useActiveJobs, useJobs } from '@/stores/jobs'
import { Tooltip } from '@/components/ui/tooltip'

/** Bottom-left stack of live progress cards for running jobs (finished jobs announce through the toast system). */
export function JobToasts() {
  const active = useActiveJobs().filter((j) => !j.dismissed)
  const dismiss = useJobs((s) => s.dismiss)
  return (
    <div
      className="toast-viewport job-viewport"
      role="region"
      aria-label="Running jobs"
    >
      <AnimatePresence initial={false}>
        {active.slice(0, 3).map((j) => (
          <motion.div
            key={j.id}
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="toast job"
            data-testid="job-toast"
          >
            <span className="spinner" style={{ marginTop: 3, color: 'var(--primary-hover)' }} aria-hidden />
            <div className="toast-body">
              <b>{j.label}</b>
              <p>
                {j.status === 'queued' ? 'Queued' : j.stage || 'Working'} · {j.progress}%
              </p>
              <div className="progress" role="progressbar" aria-valuenow={j.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${j.label} progress`}>
                <i style={{ width: `${j.progress}%` }} />
              </div>
            </div>
            <Tooltip content="Hide (the job keeps running)">
              <button className="toast-close" aria-label="Hide job card" onClick={() => dismiss(j.id)}>
                <X size={14} />
              </button>
            </Tooltip>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
