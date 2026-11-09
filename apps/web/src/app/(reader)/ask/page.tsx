import type { Metadata } from 'next'
import { AskClient } from '@/components/ask/AskClient'

export const metadata: Metadata = {
  title: 'Ask',
  description: 'Ask what developers are building and get cited answers from the feed.',
}

export default function AskPage() {
  return <AskClient />
}
