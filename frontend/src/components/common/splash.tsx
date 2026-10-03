import { Sparkles } from 'lucide-react'

export function Splash({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--background)' }} role="status" aria-live="polite">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div className="brand-mark" style={{ width: 44, height: 44, borderRadius: 13 }}>
          <Sparkles size={22} />
        </div>
        <span className="spinner" style={{ width: 18, height: 18 }} />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  )
}
