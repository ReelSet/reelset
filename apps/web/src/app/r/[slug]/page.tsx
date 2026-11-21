import Link from 'next/link'
import { errorFields } from '@reelset/core'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'
import { FeedClient } from '@/components/feed/FeedClient'
import { JsonLd, PageChrome } from '@/components/seo/PageChrome'
import { ReelPanel } from '@/components/feed/ReelPanel'
import { ReelArticle } from '@/components/seo/ReelArticle'
import type { FeedResponse } from '@/lib/api-types'
import { parseReelParam, reelPath } from '@/lib/reel-url'
import { reelJsonLd } from '@/lib/seo/json-ld'
import { SITE_NAME, metaDescription, metaTitle } from '@/lib/seo/site'
import { leadWith } from '@/server/feed'
import { routeLog } from '@/server/logger'
import { cachedAnonFeed, cachedFocusItem, cachedReelPage } from '@/server/seo-cache'

// ISR per reel, built on first visit. The HTML is anonymous: FeedClient re-fetches liked/saved
// state and the ?topic= / ?source= scope in the browser. Takedowns revalidate the reel tag.
export const revalidate = 3600
export const dynamicParams = true
export const generateStaticParams = async (): Promise<{ slug: string }[]> => []

type Props = { params: Promise<{ slug: string }> }

// generateMetadata and the page share one lookup per render.
const getReel = cache(async (slug: string) => {
  const param = parseReelParam(slug)
  if (!param) return null
  return cachedReelPage(param, revalidate)
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
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${path}/opengraph-image`],
    },
    ...(reel.visibility === 'private' ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function ReelRoute({ params }: Props) {
  const { slug } = await params
  const reel = await getReel(slug)
  if (!reel) notFound()
  const canonical = reelPath(reel)
  if (`/r/${slug}` !== canonical) permanentRedirect(canonical)

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
          <Link
            href="/"
            className="mt-10 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95"
          >
            Watch today&apos;s reels
          </Link>
        </div>
      </PageChrome>
    )
  }

  const log = routeLog('r/[slug]').child({ itemId: reel.id })
  let initial: FeedResponse | undefined
  try {
    const [feed, focus] = await Promise.all([
      cachedAnonFeed(revalidate),
      cachedFocusItem(reel.id, revalidate),
    ])
    initial = { ...feed, items: leadWith(feed.items, focus) }
  } catch (err) {
    log.error(errorFields(err), 'reel page feed failed, client will load it')
  }

  return (
    <>
      {jsonLd}
      <FeedClient initial={initial} about={<ReelPanel reel={reel} />} aboutItemId={reel.id} />
    </>
  )
}
