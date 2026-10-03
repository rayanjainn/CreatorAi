'use client'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0b0e', color: '#f4f4f5', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: 440, padding: 24 }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>CreatorAI hit an unexpected error</h1>
          <p style={{ color: '#a1a1aa', fontSize: 14, lineHeight: 1.6 }}>{error.message}</p>
          <button onClick={reset} style={{ marginTop: 18, padding: '10px 18px', borderRadius: 10, border: 0, background: '#8b5cf6', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
