'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#09090b',
          color: '#f4f4f5',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Something broke</h1>
          <p style={{ color: '#a1a1aa' }}>
            Reelset hit an unexpected error. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#c8f751',
              color: '#0b0d04',
              border: 0,
              borderRadius: 999,
              padding: '10px 20px',
              fontWeight: 500,
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ color: '#71717a', fontSize: 11, fontFamily: 'monospace' }}>
              ref {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
