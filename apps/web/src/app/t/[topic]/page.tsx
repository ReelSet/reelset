import { parseSource } from '@reelset/core'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'
import { EmptyFilter, ReelGrid, SourceFilter, TopicPills } from '@/components/seo/Browse'
import { JsonLd, PageChrome } from '@/components/seo/PageChrome'
import { sourceMeta } from '@/components/ui/sources'
import { asSeenOn, relatedTopics, sourceChips } from '@/lib/seo/browse'
import { groupTopics } from '@/lib/seo/feeds'
import { topicJsonLd } from '@/lib/seo/json-ld'
import { MIN_INDEXED_TOPIC_REELS, SITE_NAME } from '@/lib/seo/site'
import { topicSlug } from '@/lib/reel-url'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import {
  labelsForSlug,
  listReelSummaries,
  listSourceCounts,
  listTopicLabels,
} from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

const TOPIC_PAGE_REELS = 60

const RELATED_TOPICS = 10

type Props = {
  params: Promise<{ topic: string }>
  searchParams: Promise<{ source?: string | string[] }>
}

async function activeSource(searchParams: Props['searchParams']): Promise<string | null> {
  const raw = (await searchParams).source
  if (raw === undefined) return null
  return parseSource(Array.isArray(raw) ? raw[0] : raw, routeLog('t/[topic]'))
}

const getTopic = cache(async (raw: string) => {
  const slug = topicSlug(decodeURIComponent(raw))
  if (!slug) return null
  const db = getDb()
  const rows = await listTopicLabels(db)
  const labels = labelsForSlug(rows, slug)
  if (labels.length === 0) return null
  const group = groupTopics(rows.filter((r) => labels.includes(r.label)))[0]
  if (!group) return null
  const [reels, sourceCounts] = await Promise.all([
    listReelSummaries(db, mediaBaseUrl(), { limit: TOPIC_PAGE_REELS, labels }),
    listSourceCounts(db, labels),
  ])
  routeLog('t/[topic]').info({ slug, reels: reels.length }, 'topic page loaded')
  return { slug, label: group.label, count: group.count, labels, reels, sourceCounts }
})

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { topic: raw } = await params
  const topic = await getTopic(raw)
  if (!topic) return { title: 'Topic not found', robots: { index: false } }
  const source = await activeSource(searchParams)
  return {
    title: source
      ? `${topic.label} reels from ${sourceMeta(source).label}`
      : `${topic.label} reels`,
    description: `${topic.count} short video explainers about ${topic.label} from GitHub, Hacker News, Reddit, YouTube, papers and tech news, each with a summary and sources.`,
    alternates: { canonical: `/t/${topic.slug}` },
    robots:
      source || topic.count < MIN_INDEXED_TOPIC_REELS ? { index: false, follow: true } : undefined,
    openGraph: { type: 'website', url: `/t/${topic.slug}`, siteName: SITE_NAME },
  }
}

export default async function TopicPage({ params, searchParams }: Props) {
  const { topic: raw } = await params
  const topic = await getTopic(raw)
  if (!topic) notFound()
  const source = await activeSource(searchParams)
  if (raw !== topic.slug) permanentRedirect(`/t/${topic.slug}${source ? `?source=${source}` : ''}`)

  const path = `/t/${topic.slug}`
  const reels = source
    ? await listReelSummaries(getDb(), mediaBaseUrl(), {
        limit: TOPIC_PAGE_REELS,
        labels: topic.labels,
        source,
      })
    : topic.reels
  const related = relatedTopics(topic.reels, topic.slug, RELATED_TOPICS)

  return (
    <PageChrome wide>
      <JsonLd data={topicJsonLd(topic.label, path, topic.reels)} />
      <section className="animate-fade-up mt-10">
        <nav aria-label="Breadcrumb" className="text-xs text-faint">
          <a href="/t" className="transition hover:text-fg">
            Topics
          </a>
          <span aria-hidden className="mx-1.5">
            /
          </span>
          <span className="text-muted">{topic.label}</span>
        </nav>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">
          {topic.label}
        </h1>
        <p className="mt-2 max-w-lg text-sm text-muted">
          {topic.count} {topic.count === 1 ? 'reel' : 'reels'}: 60-second explainers of what
          developers are shipping and discussing about {topic.label}, newest first.
        </p>
        {related.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
              Related
            </p>
            <div className="mt-2">
              <TopicPills topics={related} source={source} showCounts={false} />
            </div>
          </div>
        )}
      </section>

      <div className="mt-6">
        <SourceFilter
          chips={sourceChips({
            path,
            total: topic.count,
            counts: topic.sourceCounts,
            active: source,
          })}
        />
      </div>

      <div className="mt-6">
        {reels.length > 0 ? (
          <ReelGrid reels={asSeenOn(reels, source)} scope={{ topic: topic.slug, source }} />
        ) : (
          <EmptyFilter label={source ? sourceMeta(source).label : ''} resetHref={path} />
        )}
      </div>
    </PageChrome>
  )
}
