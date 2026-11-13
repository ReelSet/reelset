import type { Metadata } from 'next'
import { AskClient } from '@/components/ask/AskClient'
import { loadAskSuggestions } from '@/server/ask-suggestions'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Ask',
  description: 'Ask what developers are building and get cited answers from the feed.',
}

export default async function AskPage() {
  const [user, suggestions] = await Promise.all([
    getOptionalUser().catch(() => null),
    loadAskSuggestions(getDb(), routeLog('ask/page')),
  ])
  return <AskClient signedIn={user !== null} suggestions={suggestions} />
}
