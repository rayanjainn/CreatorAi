'use client'

import { BeatRow } from './beat-row'
import type { BeatMatch } from '@/lib/api/types'

/** Beats grouped by scene (left: what you say, right: the footage that says it). */
export function ScriptFootageView({ beats, projectId }: { beats: BeatMatch[]; projectId: string }) {
  const scenes = new Map<number, BeatMatch[]>()
  for (const b of beats) scenes.set(b.scene_idx, [...(scenes.get(b.scene_idx) ?? []), b])
  return (
    <div className="sf-view" data-testid="script-footage-view">
      <div className="sf-head" aria-hidden>
        <span>Script beat</span>
        <span>Matched footage</span>
      </div>
      <ul className="beat-list">
        {[...scenes.entries()].map(([idx, rows]) => (
          <li key={idx} className="beat-scene">
            <ul>
              {rows.map((b) => (
                <BeatRow key={b.script_beat_id} beat={b} projectId={projectId} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
