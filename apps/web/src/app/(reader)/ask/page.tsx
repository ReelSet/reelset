import type { Metadata } from 'next'
import { AskClient } from '@/components/ask/AskClient'
import { loadAskSuggestions } from '@/server/ask-suggestions'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const revalidate = 3600
export const metadata: Metadata = {
  title: 'Ask',
  description: 'Ask what developers are building and get cited answers from the feed.',
}

export default async function AskPage() {
  const suggestions = await loadAskSuggestions(getDb(), routeLog('ask/page'))
  return <AskClient suggestions={suggestions} />
}
