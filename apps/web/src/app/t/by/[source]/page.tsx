import { parseSource } from '@reelset/core'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { routeLog } from '@/server/logger'
import { TopicsIndex, topicsMetadata } from '../../topics-index'

// Served for /t?source=<source> through the proxy rewrite; one cached page per source.
export const revalidate = 300
export const dynamicParams = true
export const generateStaticParams = async (): Promise<{ source: string }[]> => []

type Props = { params: Promise<{ source: string }> }

async function sourceOf(params: Props['params']): Promise<string | null> {
  return parseSource((await params).source, routeLog('t/by/[source]'))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicsMetadata(await sourceOf(params))
}

export default async function TopicsBySourcePage({ params }: Props) {
  const source = await sourceOf(params)
  if (!source) redirect('/t')
  return <TopicsIndex source={source} />
}
