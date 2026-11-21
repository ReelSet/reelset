import { parseSource } from '@reelset/core'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { routeLog } from '@/server/logger'
import { TopicView, topicMetadata } from '../../topic-view'

// Served for /t/<topic>?source=<source> through the proxy rewrite.
export const revalidate = 300
export const dynamicParams = true
export const generateStaticParams = async (): Promise<{ topic: string; source: string }[]> => []

type Props = { params: Promise<{ topic: string; source: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { topic, source } = await params
  return topicMetadata(topic, parseSource(source, routeLog('t/[topic]/by/[source]')))
}

export default async function TopicBySourcePage({ params }: Props) {
  const { topic, source: raw } = await params
  const source = parseSource(raw, routeLog('t/[topic]/by/[source]'))
  if (!source) redirect(`/t/${encodeURIComponent(topic)}`)
  return <TopicView raw={topic} source={source} />
}
