'use client'

import { StatusPage, ghostBtn, primaryBtn } from '@/components/ui/StatusPage'

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <StatusPage title="Something broke" body="That was on us. Try again, or head back to the feed.">
      <button type="button" onClick={reset} className={primaryBtn}>
        Try again
      </button>
      <a href="/" className={ghostBtn}>
        Feed
      </a>
    </StatusPage>
  )
}
