import { INSTAGRAM_URL, GITHUB_URL } from '@/lib/links'
import { reelPath, topicPath, topicSlug } from '@/lib/reel-url'
import {
  SITE_NAME,
  SITE_SUMMARY,
  SITE_URL,
  absoluteUrl,
  isoDuration,
  metaDescription,
  topicLabel,
} from './site'
import type { ReelPageData, ReelSummary } from './types'

type JsonLd = Record<string, unknown>

const publisher: JsonLd = {
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: absoluteUrl('/icon-512.png'),
  sameAs: [INSTAGRAM_URL, GITHUB_URL],
}

/** Safe inside <script type="application/ld+json">: no `</script>` breakout. */
export function jsonLdHtml(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function siteJsonLd(): JsonLd[] {
  return [
    { '@context': 'https://schema.org', ...publisher, description: SITE_SUMMARY },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_SUMMARY,
      publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    },
  ]
}

function sourceUrls(reel: ReelPageData): string[] {
  const urls = [
    reel.canonicalUrl,
    ...reel.mentions.map((m) => m.url),
    ...reel.facts.flatMap((f) => f.sources.map((s) => s.url)),
  ]
  return [...new Set(urls)].slice(0, 20)
}

function breadcrumb(reel: ReelPageData): JsonLd {
  const crumbs = [{ name: SITE_NAME, url: SITE_URL }]
  const topic = reel.topics.find((t) => topicSlug(t))
  if (topic) crumbs.push({ name: topicLabel(topic), url: absoluteUrl(topicPath(topic)) })
  crumbs.push({ name: reel.title, url: absoluteUrl(reelPath(reel)) })
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  }
}

/** VideoObject while the video exists, else an Article; plus the breadcrumb trail. */
export function reelJsonLd(reel: ReelPageData): JsonLd[] {
  const url = absoluteUrl(reelPath(reel))
  const description = metaDescription(reel.tldr, reel.hook, reel.title)
  const uploaded = reel.renderedAt ?? reel.publishedAt
  const common = {
    '@context': 'https://schema.org',
    url,
    description,
    inLanguage: 'en',
    keywords: reel.topics.join(', ') || undefined,
    isBasedOn: reel.canonicalUrl,
    citation: sourceUrls(reel),
    publisher,
  }
  const main: JsonLd =
    reel.videoUrl && reel.posterUrl
      ? {
          ...common,
          '@type': 'VideoObject',
          name: reel.title,
          thumbnailUrl: [reel.posterUrl],
          uploadDate: uploaded,
          duration: isoDuration(reel.durationMs),
          contentUrl: reel.videoUrl,
          transcript: reel.transcript ?? undefined,
          width: 1080,
          height: 1920,
        }
      : {
          ...common,
          '@type': 'Article',
          headline: reel.title.slice(0, 110),
          datePublished: uploaded,
          dateModified: uploaded,
          image: reel.posterUrl ? [reel.posterUrl] : [absoluteUrl('/icon-512.png')],
          author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
          articleBody: [reel.tldr, reel.transcript].filter(Boolean).join('\n\n') || undefined,
        }
  return [main, breadcrumb(reel)]
}

export function topicJsonLd(label: string, path: string, reels: ReelSummary[]): JsonLd[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${label} reels`,
      url: absoluteUrl(path),
      description: `Short video explainers about ${label} from ${SITE_NAME}.`,
      publisher,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: reels.length,
        itemListElement: reels.map((r, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: absoluteUrl(reelPath(r)),
          name: r.title,
        })),
      },
    },
  ]
}
