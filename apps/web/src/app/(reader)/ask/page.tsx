import type { Metadata } from 'next'
import { AskClient } from '@/components/ask/AskClient'
import { getOptionalUser } from '@/server/auth'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Ask',
  description: 'Ask what developers are building and get cited answers from the feed.',
}

export default async function AskPage() {
  const user = await getOptionalUser().catch(() => null)
  return <AskClient signedIn={user !== null} />
}
