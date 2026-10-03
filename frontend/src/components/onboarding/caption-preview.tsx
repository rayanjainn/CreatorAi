export type CaptionStyleId = 'bold_center' | 'minimal_bottom' | 'karaoke'

export const CAPTION_STYLES: { id: CaptionStyleId; label: string; hint: string }[] = [
  { id: 'bold_center', label: 'Bold center', hint: 'Big, punchy, middle of the frame' },
  { id: 'minimal_bottom', label: 'Minimal bottom', hint: 'Small and quiet, along the bottom' },
  { id: 'karaoke', label: 'Karaoke', hint: 'The spoken word lights up' },
]

/** CSS-only preview of a caption style (no images). */
export function CaptionPreview({ id }: { id: CaptionStyleId }) {
  return (
    <div className="caption-demo" aria-hidden>
      <div className={`cap ${id}`}>
        {id === 'karaoke' ? (
          <>
            Ship it <em>today</em>
          </>
        ) : (
          'Ship it today'
        )}
      </div>
    </div>
  )
}
