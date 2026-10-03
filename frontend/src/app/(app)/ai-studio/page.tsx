'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Plus, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { HookPicker } from '@/components/script/hook-picker'
import { ScriptGenerate } from '@/components/script/script-generate'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { useContentItem, useContentList, useScript, useScriptVersions } from '@/lib/api/hooks'
import { stripDemo } from '@/lib/format'
import { useUi } from '@/stores/ui'
import type { Card } from '@/lib/api/types'

/** Hub: hooks and script generation for any project, without leaving this page. */
export default function AiStudioPage() {
  return (
    <Suspense fallback={null}>
      <Studio />
    </Suspense>
  )
}

function Studio() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const openNew = useUi((s) => s.openNewContent)
  const list = useContentList()
  const projectId = params.get('project') ?? ''
  const item = useContentItem(projectId || undefined)
  const card = item.data as Card | undefined
  const versions = useScriptVersions(projectId)
  const script = useScript(projectId, (versions.data?.length ?? 0) > 0)
  const s = script.data ?? null

  const choose = (id: string) => router.replace(id ? `${pathname}?project=${id}` : pathname)

  return (
    <div className="page">
      <PageHeader
        eyebrow="CreatorAI / AI tools"
        title="AI Studio"
        description="Pick a project and write its hook and script here. The same tools live in each project's Script tab."
        actions={
          <Button variant="secondary" onClick={() => openNew()}>
            <Plus size={14} /> New project
          </Button>
        }
      />
      <section className="card">
        <label className="field">
          <span className="field-label">Project</span>
          <Select value={projectId} onChange={(e) => choose(e.target.value)} aria-label="Project" data-testid="studio-project">
            <option value="">{list.isPending ? 'Loading…' : 'Choose a project…'}</option>
            {list.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {stripDemo(c.title)} ({c.stage})
              </option>
            ))}
          </Select>
        </label>
      </section>
      {!projectId ? (
        <EmptyState icon={<Sparkles size={22} />} title="Choose a project to start" description="Hooks and scripts belong to a project. Pick one above, or create a new one." actions={<Button onClick={() => openNew()}>New project</Button>} />
      ) : item.isPending || versions.isPending || script.isLoading ? (
        <Skeleton style={{ height: 260, borderRadius: 15 }} />
      ) : card ? (
        <div className="stack" data-testid="studio-body">
          <HookPicker projectId={projectId} script={s} />
          <ScriptGenerate item={card} script={s} />
          {s && s.scenes.length > 0 && (
            <section className="card" data-testid="studio-script">
              <div className="card-heading">
                <div>
                  <div className="eyebrow violet-text">Script · v{s.version}</div>
                  <h2>Current script</h2>
                </div>
                <ProvenanceBadge {...s.provenance} />
              </div>
              <pre className="script-md">{s.body_md}</pre>
              <Link href={`/projects/${projectId}/script`} className="button button-secondary button-sm" style={{ alignSelf: 'flex-start', marginTop: 12 }}>
                Edit in the project <ArrowRight size={13} />
              </Link>
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}
