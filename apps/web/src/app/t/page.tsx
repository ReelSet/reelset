import type { Metadata } from 'next'
import { PageChrome } from '@/components/seo/PageChrome'
import { groupTopics, indexedTopics } from '@/lib/seo/feeds'
import { getDb } from '@/server/db'
import { listTopicLabels } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Topics',
  description:
    'Every topic on Reelset: AI models, coding agents, open source, Rust, Go, web dev, DevOps and more, each with its 60-second reels.',
  alternates: { canonical: '/t' },
}

export default async function TopicsPage() {
  const topics = indexedTopics(groupTopics(await listTopicLabels(getDb())))
  return (
    <PageChrome>
      <section className="animate-fade-up mt-10">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Topics</h1>
        <p className="mt-2 text-sm text-muted">
          What developers are building and discussing, grouped by topic.
        </p>
      </section>
      <ul className="mt-8 flex flex-wrap gap-2">
        {topics.map((t) => (
          <li key={t.slug}>
            <a
              href={`/t/${t.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg"
            >
              {t.label}
              <span className="text-xs text-faint tabular-nums">{t.count}</span>
            </a>
          </li>
        ))}
      </ul>
    </PageChrome>
  )
}
