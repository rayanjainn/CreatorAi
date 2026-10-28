import Link from 'next/link'
import { Compass } from 'lucide-react'
import { LinkButton } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'radial-gradient(800px 360px at 50% 0%, #2a1d5233, transparent), var(--background)' }}>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="empty-icon" style={{ margin: '0 auto 18px', width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--accent-bg)', color: 'var(--accent-text)' }}>
          <Compass size={26} />
        </div>
        <div className="eyebrow violet-text" style={{ justifyContent: 'center' }}>
          404
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(40px, 6vw, 60px)', lineHeight: 1.05, margin: '10px 0 12px' }}>This page does not exist</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>The link may be old, or the page has not been built yet. Head back to your workspace.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
          <LinkButton href="/dashboard">Open dashboard</LinkButton>
          <LinkButton href="/calendar" variant="secondary">
            Content board
          </LinkButton>
        </div>
        <p style={{ marginTop: 22 }}>
          <Link href="/" style={{ color: 'var(--dim)', fontSize: 12 }}>
            or return to the home page
          </Link>
        </p>
      </div>
    </div>
  )
}
