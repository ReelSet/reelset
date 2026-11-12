import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'
import { JsonLd, PageChrome, ReelGrid } from '@/components/seo/PageChrome'
import { groupTopics } from '@/lib/seo/feeds'
import { topicJsonLd } from '@/lib/seo/json-ld'
import { MIN_INDEXED_TOPIC_REELS, SITE_NAME } from '@/lib/seo/site'
import { topicSlug } from '@/lib/reel-url'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { labelsForSlug, listReelSummaries, listTopicLabels } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

const TOPIC_PAGE_REELS = 60

type Props = { params: Promise<{ topic: string }> }

const getTopic = cache(async (raw: string) => {
  const slug = topicSlug(decodeURIComponent(raw))
  if (!slug) return null
  const db = getDb()
  const rows = await listTopicLabels(db)
  const labels = labelsForSlug(rows, slug)
  if (labels.length === 0) return null
  const group = groupTopics(rows.filter((r) => labels.includes(r.label)))[0]
  if (!group) return null
  const reels = await listReelSummaries(db, mediaBaseUrl(), { limit: TOPIC_PAGE_REELS, labels })
  routeLog('t/[topic]').info({ slug, reels: reels.length }, 'topic page loaded')
  return { slug, label: group.label, count: group.count, reels }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { topic: raw } = await params
  const topic = await getTopic(raw)
  if (!topic) return { title: 'Topic not found', robots: { index: false } }
  return {
    title: `${topic.label} reels`,
    description: `${topic.count} short video explainers about ${topic.label} from GitHub, Hacker News, Reddit, YouTube, papers and tech news, each with a summary and sources.`,
    alternates: { canonical: `/t/${topic.slug}` },
    robots: topic.count < MIN_INDEXED_TOPIC_REELS ? { index: false, follow: true } : undefined,
    openGraph: { type: 'website', url: `/t/${topic.slug}`, siteName: SITE_NAME },
  }
}

export default async function TopicPage({ params }: Props) {
  const { topic: raw } = await params
  const topic = await getTopic(raw)
  if (!topic) notFound()
  if (raw !== topic.slug) permanentRedirect(`/t/${topic.slug}`)

  return (
    <PageChrome>
      <JsonLd data={topicJsonLd(topic.label, `/t/${topic.slug}`, topic.reels)} />
      <section className="animate-fade-up mt-10">
        <p className="text-xs uppercase tracking-[0.12em] text-faint">Topic</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
          {topic.label}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {topic.count} {topic.count === 1 ? 'reel' : 'reels'}: 60-second explainers of what
          developers are shipping and discussing about {topic.label}, newest first.
        </p>
      </section>
      <div className="mt-8">
        <ReelGrid reels={topic.reels} />
      </div>
    </PageChrome>
  )
}
