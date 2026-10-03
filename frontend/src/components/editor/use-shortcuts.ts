'use client'

import { useEffect } from 'react'
import { deleteSelection, seekTo, splitAtPlayhead, trimToPlayhead } from '@/lib/editor/actions'
import { saveNow } from '@/lib/editor/controller'
import { getEngine } from '@/lib/editor/engine-store'
import { useEditor } from '@/stores/editor'

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Space', what: 'Play / pause' },
  { keys: '← / →', what: 'Back / forward one frame' },
  { keys: 'Shift + ← / →', what: 'Back / forward one second' },
  { keys: 'J / K / L', what: 'Back 1 s · play/pause · forward 1 s' },
  { keys: 'Home / End', what: 'Go to start / end' },
  { keys: 'V', what: 'Select tool' },
  { keys: 'T', what: 'Trim tool (shows trim handles; drag the clip edges)' },
  { keys: 'S', what: 'Split the clip at the playhead' },
  { keys: '[ / ]', what: 'Trim the clip start / end to the playhead' },
  { keys: 'Delete', what: 'Delete the selection (video ripples)' },
  { keys: 'Ctrl/⌘ + Z', what: 'Undo' },
  { keys: 'Ctrl/⌘ + Shift + Z or Ctrl + Y', what: 'Redo' },
  { keys: 'Ctrl/⌘ + S', what: 'Save now' },
  { keys: 'Shift + click', what: 'Add to the selection' },
  { keys: 'Alt + drag', what: 'Move or trim without snapping' },
  { keys: '+ / −', what: 'Zoom the timeline in / out' },
  { keys: 'Ctrl/⌘ + wheel', what: 'Zoom around the pointer' },
  { keys: 'N', what: 'Toggle snapping' },
  { keys: 'Esc', what: 'Clear the selection / leave a revision preview' },
  { keys: '?', what: 'Show this list' },
]

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' ? !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type) : el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/** Global editor shortcuts (ignored while typing in a field or while a dialog is open). */
export function useEditorShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      const s = useEditor.getState()
      const eng = getEngine()
      const mod = e.metaKey || e.ctrlKey
      const key = e.key
      const range = (e.target as HTMLInputElement | null)?.type === 'range'
      const done = () => e.preventDefault()

      if (mod && key.toLowerCase() === 'z') {
        done()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && key.toLowerCase() === 'y') {
        done()
        s.redo()
        return
      }
      if (mod && key.toLowerCase() === 's') {
        done()
        void saveNow()
        return
      }
      if (mod || e.altKey) return
      switch (key) {
        case ' ':
          done()
          eng?.toggle()
          return
        case 'k':
        case 'K':
          done()
          eng?.toggle()
          return
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (range) return
          done()
          const dir = key === 'ArrowLeft' ? -1 : 1
          if (e.shiftKey) seekTo(s.playhead + dir)
          else eng?.step(dir)
          return
        }
        case 'j':
        case 'J':
          done()
          seekTo(s.playhead - 1)
          return
        case 'l':
        case 'L':
          done()
          seekTo(s.playhead + 1)
          return
        case 'Home':
          done()
          seekTo(0)
          return
        case 'End':
          done()
          seekTo(s.timeline.duration)
          return
        case 'v':
        case 'V':
          s.setTool('select')
          return
        case 't':
        case 'T':
          s.setTool(s.tool === 'trim' ? 'select' : 'trim')
          return
        case 's':
        case 'S':
          done()
          splitAtPlayhead()
          return
        case '[':
          done()
          trimToPlayhead('start')
          return
        case ']':
          done()
          trimToPlayhead('end')
          return
        case 'Delete':
        case 'Backspace':
          if (s.selection.length) {
            done()
            deleteSelection()
          }
          return
        case '+':
        case '=':
          s.setZoom(s.zoom * 1.4)
          return
        case '-':
        case '_':
          s.setZoom(s.zoom / 1.4)
          return
        case 'n':
        case 'N':
          s.setSnap(!s.snap)
          return
        case 'Escape':
          if (s.preview) s.setPreview(null)
          else if (s.selection.length) s.select([])
          return
        case '?':
          done()
          s.setHelpOpen(!s.helpOpen)
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

