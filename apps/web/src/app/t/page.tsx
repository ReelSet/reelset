import { parseSource } from '@reelset/core'
import type { Metadata } from 'next'
import { EmptyFilter, SourceFilter, TopicPills, TopicShelf } from '@/components/seo/Browse'
import { TopicExplorer } from '@/components/seo/TopicExplorer'
import { PageChrome } from '@/components/seo/PageChrome'
import { sourceMeta } from '@/components/ui/sources'
import { asSeenOn, buildShelves, sourceChips, withVisibleViews } from '@/lib/seo/browse'
import { groupTopics, indexedTopics } from '@/lib/seo/feeds'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { loadCountRules } from '@/server/counts'
import { routeLog } from '@/server/logger'
import {
  countRenderedReels,
  listReelSummaries,
  listSourceCounts,
  listTopicLabels,
} from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

const SHELF_POOL = 300
const SHELVES = 6
const PER_SHELF = 12

type Props = { searchParams: Promise<{ source?: string | string[] }> }

async function activeSource(searchParams: Props['searchParams']): Promise<string | null> {
  const raw = (await searchParams).source
  if (raw === undefined) return null
  return parseSource(Array.isArray(raw) ? raw[0] : raw, routeLog('t'))
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const source = await activeSource(searchParams)
  return {
    title: source ? `${sourceMeta(source).label} topics` : 'Topics',
    description:
      'Every topic on Reelset: AI models, coding agents, open source, Rust, Go, web dev, DevOps and more, each with its 60-second reels.',
    alternates: { canonical: '/t' },
    robots: source ? { index: false, follow: true } : undefined,
  }
}

export default async function TopicsPage({ searchParams }: Props) {
  const source = await activeSource(searchParams)
  const db = getDb()
  const [labels, pool, counts, total, rules] = await Promise.all([
    listTopicLabels(db, source),
    listReelSummaries(db, mediaBaseUrl(), { limit: SHELF_POOL, source }),
    listSourceCounts(db),
    countRenderedReels(db),
    loadCountRules(db, routeLog('t')),
  ])
  const reels = withVisibleViews(pool, rules.views)
  const grouped = groupTopics(labels)
  const topics = source ? grouped : indexedTopics(grouped)
  const shelves = buildShelves(asSeenOn(reels, source), topics, {
    shelves: SHELVES,
    perShelf: PER_SHELF,
    minReels: source ? 2 : 3,
  })
  const shown = source ? (counts.find((c) => c.source === source)?.count ?? 0) : total
  routeLog('t').info({ source, topics: topics.length, shelves: shelves.length }, 'topics loaded')

  return (
    <PageChrome wide>
      <section className="animate-fade-up mt-10">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Topics</h1>
        <p className="mt-2 max-w-lg text-sm text-muted">
          {shown} {source ? `${sourceMeta(source).label} ` : ''}reels across {topics.length} topics.
          Pick a topic, or narrow it down to where the story broke.
        </p>
      </section>

      <TopicExplorer
        topics={topics}
        reels={asSeenOn(reels, source)}
        source={source}
        filters={
          <SourceFilter
            chips={sourceChips({ path: '/t', total, counts, active: source })}
            sticky={false}
          />
        }
      >
        {topics.length === 0 ? (
          <div className="mt-8">
            <EmptyFilter label={source ? sourceMeta(source).label : ''} resetHref="/t" />
          </div>
        ) : (
          <>
            <div className="mt-8 flex flex-col gap-10">
              {shelves.map((shelf) => (
                <TopicShelf key={shelf.topic.slug} shelf={shelf} source={source} />
              ))}
            </div>
            <section aria-labelledby="all-topics" className="mt-12 border-t border-line pt-8">
              <h2 id="all-topics" className="text-[17px] font-semibold tracking-tight">
                All topics
              </h2>
              <div className="mt-4">
                <TopicPills topics={topics} source={source} />
              </div>
            </section>
          </>
        )}
      </TopicExplorer>
    </PageChrome>
  )
}
