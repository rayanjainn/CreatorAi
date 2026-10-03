'use client'

import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useRestoreScript, useScriptVersions } from '@/lib/api/hooks'
import { relativeTime } from '@/lib/time'

export function ScriptVersions({ projectId }: { projectId: string }) {
  const versions = useScriptVersions(projectId)
  const restore = useRestoreScript(projectId)
  return (
    <section className="card" data-testid="script-versions">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">History</div>
          <h2>Versions</h2>
        </div>
        <History size={18} className="muted" aria-hidden />
      </div>
      {versions.isPending ? (
        <Skeleton style={{ height: 80, marginTop: 12 }} />
      ) : (
        <ul className="version-list">
          {versions.data?.map((v) => (
            <li key={v.id} data-current={v.is_current} data-testid="script-version">
              <div>
                <b>v{v.version}</b>
                {v.is_current && <span className="badge badge-green" style={{ marginLeft: 8 }}>Current</span>}
                {v.approved && <span className="badge badge-cyan" style={{ marginLeft: 6 }}>Approved</span>}
                {v.edited && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Edited</span>}
                <small>
                  {v.scene_count} scenes · {v.word_count} words · {relativeTime(v.created_at)}
                </small>
              </div>
              <ProvenanceBadge {...v.provenance} />
              {!v.is_current && (
                <Button size="sm" variant="secondary" loading={restore.isPending && restore.variables === v.id} onClick={() => restore.mutate(v.id)} data-testid="restore-version">
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
