'use client'

import { useCallback, useRef } from 'react'

type Props = {
  /** `vertical` is a thin bar between two columns (drag left/right); `horizontal` sits between two rows. */
  orientation: 'vertical' | 'horizontal'
  /** Current size in px of the panel this bar resizes. */
  value: number
  min: number
  max: number
  /** Which way a positive pointer movement changes `value`: `1` grows it, `-1` shrinks it. */
  direction: 1 | -1
  onChange: (px: number) => void
  onReset: () => void
  label: string
  testId?: string
}

/** A draggable, keyboard-operable separator (WAI-ARIA window splitter). Double-click resets the size. */
export function Splitter({ orientation, value, min, max, direction, onChange, onReset, label, testId }: Props) {
  const start = useRef<{ pos: number; size: number } | null>(null)
  const horizontal = orientation === 'horizontal'

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      start.current = { pos: horizontal ? e.clientY : e.clientX, size: value }
      document.body.dataset.resizing = orientation
    },
    [horizontal, orientation, value],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = start.current
      if (!s) return
      const delta = (horizontal ? e.clientY : e.clientX) - s.pos
      onChange(Math.max(min, Math.min(max, s.size + delta * direction)))
    },
    [direction, horizontal, max, min, onChange],
  )
  const end = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    start.current = null
    delete document.body.dataset.resizing
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16
    const grow = horizontal ? 'ArrowUp' : 'ArrowRight'
    const shrink = horizontal ? 'ArrowDown' : 'ArrowLeft'
    let next: number | null = null
    if (e.key === grow) next = value + step * direction
    else if (e.key === shrink) next = value - step * direction
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else if (e.key === 'Enter') {
      onReset()
      e.preventDefault()
      return
    }
    if (next === null) return
    e.preventDefault()
    onChange(Math.max(min, Math.min(max, next)))
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="splitter"
      data-orientation={orientation}
      data-testid={testId}
      title={`${label} (drag, arrow keys, double-click to reset)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="splitter-grip" aria-hidden />
    </div>
  )
}
