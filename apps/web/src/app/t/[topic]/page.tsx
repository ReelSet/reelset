import type { Metadata } from 'next'
import { TopicView, topicMetadata } from './topic-view'

// `?source=` variants are rewritten by proxy.ts to /t/<topic>/by/<source>.
export const revalidate = 300
export const dynamicParams = true
export const generateStaticParams = async (): Promise<{ topic: string }[]> => []

type Props = { params: Promise<{ topic: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).topic, null)
}

export default async function TopicPage({ params }: Props) {
  return <TopicView raw={(await params).topic} source={null} />
}
