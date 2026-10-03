import type { ReactNode } from 'react'
import { Check, Clock3 } from 'lucide-react'
import { PageHeader } from './page-header'

/** Honest "this backend is not built yet" page. Never render fake data in its place. */
export function NotAvailablePage({
  eyebrow,
  title,
  summary,
  willDo,
  status = 'Not available yet',
  needs,
  children,
}: {
  eyebrow: string
  title: string
  summary: string
  /** What the feature will do once it exists. */
  willDo: string[]
  status?: string
  /** What it depends on (backend module, credentials). */
  needs?: string[]
  children?: ReactNode
}) {
  return (
    <div className="page" data-testid="not-available">
      <PageHeader eyebrow={eyebrow} title={title} />
      <div className="na-panel">
        <div>
          <span className="na-status">
            <Clock3 size={13} /> {status}
          </span>
          <h2>This part of CreatorAi is not built yet.</h2>
          <p>{summary}</p>
          <p style={{ marginTop: 10 }}>
            Nothing on this page is simulated: there are no placeholder numbers or sample results, because showing them would be
            misleading.
          </p>
          {children}
        </div>
        <div className="na-aside">
          <h3>What it will do</h3>
          <ul className="na-list">
            {willDo.map((w) => (
              <li key={w}>
                <Check size={15} />
                {w}
              </li>
            ))}
          </ul>
          {needs && needs.length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>Depends on</h3>
              <ul className="na-list">
                {needs.map((n) => (
                  <li key={n}>
                    <Clock3 size={15} />
                    {n}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Small inline version for cards (e.g. the YouTube card in settings). */
export function NotAvailableInline({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="na-compact" data-testid="not-available-inline">
      <div className="stat-icon amber">{icon ?? <Clock3 size={16} />}</div>
      <div>
        <h4>{title}</h4>
        <p>{children}</p>
      </div>
    </div>
  )
}
