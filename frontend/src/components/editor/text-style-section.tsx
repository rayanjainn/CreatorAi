'use client'

import { AlignCenter, AlignLeft, AlignRight, LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Row, Section } from './fields'
import { DEFAULT_TEXT_STYLE, patchLayer, type OverlayItem, type TextFont, type TextStyle } from '@/lib/timeline'
import { useEditor } from '@/stores/editor'

const FONTS: { id: TextFont; label: string }[] = [
  { id: 'montserrat', label: 'Montserrat (bold, modern)' },
  { id: 'inter', label: 'Inter (clean)' },
  { id: 'serif', label: 'Serif (editorial)' },
  { id: 'mono', label: 'Mono (technical)' },
]
const SWATCHES = ['#FFFFFF', '#000000', '#FFD60A', '#FF4D6D', '#7CFFB2', '#38BDF8', '#B9A5FF', '#FF8A3D']

/** Look and position of a text or lower-third overlay. The preview and the export use the same numbers. */
export function TextStyleSection({ item, disabled }: { item: OverlayItem; disabled: boolean }) {
  const apply = useEditor((s) => s.apply)
  const st: TextStyle = { ...DEFAULT_TEXT_STYLE, ...(item.style ?? {}) }
  const set = (patch: Partial<TextStyle>, key?: string) =>
    apply((t) => patchLayer(t, item.id, { style: patch }), { note: 'Styled text', key: key ? `${key}:${item.id}` : undefined })
  const end = () => useEditor.getState().endGesture()

  return (
    <Section title="Text style" aside={item.style ? <small className="muted">Drag the text on the preview to move it</small> : undefined}>
      <Row label="Font">
        <Select aria-label="Font" value={st.font} disabled={disabled} onChange={(e) => set({ font: e.target.value as TextFont })} data-testid="text-font">
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Size">
        <input type="range" className="slider" min={2} max={14} step={0.5} value={st.size * 100} disabled={disabled} aria-label="Text size" data-testid="text-size" onChange={(e) => set({ size: Number(e.target.value) / 100 }, 'tsize')} onPointerUp={end} />
      </Row>
      <Row label="Width">
        <input type="range" className="slider" min={30} max={100} step={1} value={st.width * 100} disabled={disabled} aria-label="Text box width" onChange={(e) => set({ width: Number(e.target.value) / 100 }, 'twidth')} onPointerUp={end} />
      </Row>
      <div className="insp-colors">
        <label className="insp-color">
          <input type="color" value={st.color} disabled={disabled} aria-label="Text colour" data-testid="text-color" onChange={(e) => set({ color: e.target.value.toUpperCase() }, 'tcolor')} onBlur={end} />
          <span>Text {st.color}</span>
        </label>
        {st.bg ? (
          <label className="insp-color">
            <input type="color" value={st.bg} disabled={disabled} aria-label="Box colour" data-testid="text-bg" onChange={(e) => set({ bg: e.target.value.toUpperCase() }, 'tbg')} onBlur={end} />
            <span>Box {st.bg}</span>
          </label>
        ) : (
          <button type="button" className="insp-color" disabled={disabled} onClick={() => set({ bg: '#000000' })} data-testid="text-add-box">
            <span>+ Add a box behind</span>
          </button>
        )}
      </div>
      <div className="insp-swatches" role="group" aria-label="Quick text colours">
        {SWATCHES.map((c) => (
          <button key={c} type="button" style={{ background: c }} aria-label={`Text colour ${c}`} aria-pressed={st.color === c} disabled={disabled} onClick={() => set({ color: c })} />
        ))}
      </div>
      <Row label="Box">
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
          <input type="range" className="slider" min={0} max={100} step={5} value={st.bg_opacity * 100} disabled={disabled || !st.bg} aria-label="Box opacity" onChange={(e) => set({ bg_opacity: Number(e.target.value) / 100 }, 'tbgo')} onPointerUp={end} />
          <Button size="sm" variant="ghost" disabled={disabled || !st.bg} onClick={() => set({ bg: null })}>
            Remove
          </Button>
        </span>
      </Row>
      <Row label="Align">
        <div className="insp-aligns" role="group" aria-label="Text alignment">
          {(['left', 'center', 'right'] as const).map((a) => {
            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
            return (
              <button key={a} type="button" aria-label={`Align ${a}`} aria-pressed={st.align === a} disabled={disabled} onClick={() => set({ align: a })}>
                <Icon size={14} />
              </button>
            )
          })}
        </div>
      </Row>
      <Row label="Shadow">
        <input type="checkbox" checked={st.shadow} disabled={disabled} aria-label="Text shadow" onChange={(e) => set({ shadow: e.target.checked })} />
      </Row>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => set({ x: 0.5, y: 0.5 })} title="Put the text in the middle of the frame">
        <LocateFixed size={13} /> Centre on screen
      </Button>
    </Section>
  )
}
