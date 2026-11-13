import { errorFields } from '@reelset/core'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'
import { FeedClient } from '@/components/feed/FeedClient'
import { JsonLd, PageChrome } from '@/components/seo/PageChrome'
import { ReelArticle } from '@/components/seo/ReelArticle'
import type { FeedResponse } from '@/lib/api-types'
import { parseReelParam, reelPath } from '@/lib/reel-url'
import { reelJsonLd } from '@/lib/seo/json-ld'
import { SITE_NAME, metaDescription, metaTitle } from '@/lib/seo/site'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { loadFeedResponse, resolveTopicLabels } from '@/server/feed'
import { routeLog } from '@/server/logger'
import { loadReelPage } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ topic?: string | string[] }>
}

// generateMetadata and the page share one lookup per request.
const getReel = cache(async (slug: string) => {
  const param = parseReelParam(slug)
  if (!param) return null
  return loadReelPage(getDb(), param, mediaBaseUrl(), routeLog('r/[slug]'))
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const reel = await getReel(slug)
  if (!reel) return { title: 'Reel not found', robots: { index: false } }
  const path = reelPath(reel)
  const description = metaDescription(reel.tldr, reel.hook, reel.title)
  const title = metaTitle(reel.title)
  return {
    title,
    description,
    keywords: reel.topics,
    alternates: { canonical: path },
    openGraph: {
      type: reel.videoUrl ? 'video.other' : 'article',
      url: path,
      siteName: SITE_NAME,
      title,
      description,
      videos: reel.videoUrl
        ? [{ url: reel.videoUrl, type: 'video/mp4', width: 1080, height: 1920 }]
        : undefined,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ReelRoute({ params, searchParams }: Props) {
  const { slug } = await params
  const rawTopic = (await searchParams).topic
  const topicParam = (Array.isArray(rawTopic) ? rawTopic[0] : rawTopic) || null
  const reel = await getReel(slug)
  if (!reel) notFound()
  const canonical = reelPath(reel)
  const query = topicParam ? `?topic=${encodeURIComponent(topicParam)}` : ''
  if (`/r/${slug}` !== canonical) permanentRedirect(`${canonical}${query}`)

  const jsonLd = <JsonLd data={reelJsonLd(reel)} />
  const article = <ReelArticle reel={reel} />

  if (!reel.videoUrl) {
    return (
      <PageChrome>
        {jsonLd}
        <div className="animate-fade-up mt-10">
          <p className="mb-6 rounded-md border border-line bg-surface px-4 py-3 text-sm text-muted">
            This reel&apos;s video has been retired. The summary, transcript and sources are below.
          </p>
          {article}
          <a
            href="/"
            className="mt-10 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95"
          >
            Watch today&apos;s reels
          </a>
        </div>
      </PageChrome>
    )
  }

  const log = routeLog('r/[slug]').child({ itemId: reel.id })
  let initial: FeedResponse | undefined
  let topic: string | null = null
  let labelsForFeed: string[] | undefined
  try {
    await cookies()
    const user = await getOptionalUser()
    if (topicParam) {
      const labels = await resolveTopicLabels(getDb(), topicParam)
      if (labels.length > 0) {
        topic = topicParam
        labelsForFeed = labels
      }
    }
    initial = await loadFeedResponse(getDb(), {
      profileId: user?.id ?? null,
      authenticated: user !== null,
      base: mediaBaseUrl(),
      focusId: reel.id,
      labels: labelsForFeed,
      log,
    })
  } catch (err) {
    log.error(errorFields(err), 'reel page feed failed, client will load it')
  }

  return (
    <>
      {jsonLd}
      <FeedClient initial={initial} about={article} aboutItemId={reel.id} topic={topic} />
    </>
  )
}
