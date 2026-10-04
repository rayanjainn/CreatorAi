'use client'

import { useState } from 'react'
import { ImagePlus, ListChecks, Sparkles } from 'lucide-react'
import { TwinChat } from '@/components/twin/twin-chat'
import { saveNow } from '@/lib/editor/controller'
import { HistoryPanel } from './history-panel'
import { MediaPanel } from './media-panel'
import { cn } from '@/lib/utils'

type Tab = 'changes' | 'media' | 'ask'

/** Left column of the editor: the change checklist, and the media library you can drag from or drop files onto. */
export function LeftPanel({ clipId, contentItemId }: { clipId: string; contentItemId: string }) {
  const [tab, setTab] = useState<Tab>('changes')
  return (
    <aside className="left-panel" aria-label="Side panel" data-testid="left-panel">
      <div className="lp-tabs" role="tablist" aria-label="Side panel">
        <button type="button" role="tab" aria-selected={tab === 'changes'} className={cn(tab === 'changes' && 'active')} onClick={() => setTab('changes')} data-testid="tab-changes">
          <ListChecks size={13} /> Changes
        </button>
        <button type="button" role="tab" aria-selected={tab === 'media'} className={cn(tab === 'media' && 'active')} onClick={() => setTab('media')} data-testid="tab-media">
          <ImagePlus size={13} /> Media
        </button>
        <button type="button" role="tab" aria-selected={tab === 'ask'} className={cn(tab === 'ask' && 'active')} onClick={() => setTab('ask')} data-testid="tab-ask">
          <Sparkles size={13} /> Ask
        </button>
      </div>
      <div className="lp-body">{tab === 'changes' ? <HistoryPanel clipId={clipId} /> : tab === 'media' ? <MediaPanel contentItemId={contentItemId} /> : <TwinChat compact contentItemId={contentItemId} clipId={clipId} beforeApply={() => saveNow()} onApplied={() => window.location.reload()} />}</div>
    </aside>
  )
}
