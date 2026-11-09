'use client'

import { useEffect } from 'react'
import { ErrorState, quietBtn } from '@/components/ui/ErrorState'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('admin route error', error.digest)
  }, [error])
  return (
    <ErrorState
      className="py-20"
      title="This admin page failed to load"
      body="A query failed or timed out. Retry, or check the Source health page."
      onRetry={reset}
      digest={error.digest}
    >
      <a href="/admin" className={quietBtn}>
        Pipeline
      </a>
    </ErrorState>
  )
}
