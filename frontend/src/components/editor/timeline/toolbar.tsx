'use client'

import { Magnet, MousePointer2, Music, PanelBottom, Redo2, Scissors, Trash2, Type, Undo2, ChevronsLeftRight, Captions } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { addCaptionAtPlayhead, addOverlayAtPlayhead, deleteSelection, splitAtPlayhead } from '@/lib/editor/actions'
import { useEditor } from '@/stores/editor'

type ToolDef = { id: string; label: string; key?: string; Icon: typeof Scissors; active?: boolean; disabled?: boolean; onClick: () => void; testid: string }

/** Tool column down the left edge of the timeline (select, trim, split, delete, text, lower third, audio, undo/redo, snap). */
export function TimelineToolbar({ onAddAudio }: { onAddAudio: () => void }) {
  const tool = useEditor((s) => s.tool)
  const snap = useEditor((s) => s.snap)
  const canUndo = useEditor((s) => s.history.past.length > 0)
  const canRedo = useEditor((s) => s.history.future.length > 0)
  const preview = useEditor((s) => !!s.preview)
  const busy = useEditor((s) => !!s.busy)
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const hasVideo = useEditor((s) => s.timeline.tracks.video.length > 0)
  const setTool = useEditor((s) => s.setTool)
  const setSnap = useEditor((s) => s.setSnap)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const ro = preview || busy

  const groups: ToolDef[][] = [
    [
      { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2, active: tool === 'select', onClick: () => setTool('select'), testid: 'tool-select' },
      { id: 'trim', label: 'Trim: drag clip edges, or [ and ] trim to the playhead', key: 'T', Icon: ChevronsLeftRight, active: tool === 'trim', onClick: () => setTool('trim'), testid: 'tool-trim' },
      { id: 'split', label: 'Split at playhead', key: 'S', Icon: Scissors, disabled: ro || !hasVideo, onClick: () => splitAtPlayhead(), testid: 'tool-split' },
      { id: 'delete', label: 'Delete selection', key: 'Del', Icon: Trash2, disabled: ro || !hasSelection, onClick: () => deleteSelection(), testid: 'tool-delete' },
    ],
    [
      { id: 'text', label: 'Add text overlay at playhead', Icon: Type, disabled: ro || !hasVideo, onClick: () => addOverlayAtPlayhead('text'), testid: 'tool-text' },
      { id: 'lower', label: 'Add lower third at playhead', Icon: PanelBottom, disabled: ro || !hasVideo, onClick: () => addOverlayAtPlayhead('lower_third'), testid: 'tool-lower-third' },
      { id: 'caption', label: 'Add a caption at playhead', Icon: Captions, disabled: ro || !hasVideo, onClick: () => addCaptionAtPlayhead(), testid: 'tool-caption' },
      { id: 'audio', label: 'Add music or sound from your library', Icon: Music, disabled: ro || !hasVideo, onClick: onAddAudio, testid: 'tool-audio' },
    ],
    [
      { id: 'undo', label: 'Undo', key: 'Ctrl Z', Icon: Undo2, disabled: ro || !canUndo, onClick: undo, testid: 'tool-undo' },
      { id: 'redo', label: 'Redo', key: 'Ctrl Shift Z', Icon: Redo2, disabled: ro || !canRedo, onClick: redo, testid: 'tool-redo' },
    ],
    [{ id: 'snap', label: snap ? 'Snapping on (N)' : 'Snapping off (N)', key: 'N', Icon: Magnet, active: snap, onClick: () => setSnap(!snap), testid: 'tool-snap' }],
  ]
  return (
    <div className="tl-toolbar" role="toolbar" aria-label="Timeline tools" aria-orientation="vertical">
      {groups.map((g, i) => (
        <div className="tl-tool-group" key={i}>
          {g.map(({ id, label, key, Icon, active, disabled, onClick, testid }) => (
            <Tooltip key={id} side="right" content={<span>{label}{key && <kbd className="tip-kbd">{key}</kbd>}</span>}>
              <button type="button" className="tl-tool" aria-label={label} aria-pressed={active} data-active={active} disabled={disabled} onClick={onClick} data-testid={testid}>
                <Icon size={16} aria-hidden />
              </button>
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  )
}
