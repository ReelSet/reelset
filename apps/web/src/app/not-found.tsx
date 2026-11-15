import Link from 'next/link'
import { StatusPage, ghostBtn, primaryBtn } from '@/components/ui/StatusPage'

export const metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="Nothing here"
      body="This page does not exist, or the reel has moved on."
    >
      <Link href="/" className={primaryBtn}>
        Back to the feed
      </Link>
      <Link href="/ask" className={ghostBtn}>
        Ask
      </Link>
    </StatusPage>
  )
}
