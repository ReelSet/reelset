'use client'

import { useEffect } from 'react'
import { StatusPage, ghostBtn, primaryBtn } from '@/components/ui/StatusPage'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('route error', error.digest)
  }, [error])
  return (
    <StatusPage
      title="Something broke"
      body="That was on us. Try again, or head back to the feed."
      reference={error.digest}
    >
      <button type="button" onClick={reset} className={primaryBtn}>
        Try again
      </button>
      <a href="/" className={ghostBtn}>
        Feed
      </a>
    </StatusPage>
  )
}
