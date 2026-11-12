import type { MetadataRoute } from 'next'
import { reelPath, topicPath, topicSlug } from '@/lib/reel-url'
import {
  MIN_INDEXED_TOPIC_REELS,
  SITE_NAME,
  SITE_SUMMARY,
  SITE_TAGLINE,
  absoluteUrl,
  metaDescription,
  topicLabel,
} from './site'
import type { ReelSummary, TopicCount } from './types'

const DAY_MS = 86_400_000

/** Groups raw topic labels by URL slug; the most used spelling names the group. */
export function groupTopics(rows: { label: string; count: number }[]): TopicCount[] {
  const groups = new Map<string, { label: string; best: number; count: number }>()
  for (const { label, count } of rows) {
    const slug = topicSlug(label)
    if (!slug) continue
    const group = groups.get(slug)
    if (!group) groups.set(slug, { label, best: count, count })
    else {
      group.count += count
      if (count > group.best) Object.assign(group, { label, best: count })
    }
  }
  return [...groups.entries()]
    .map(([slug, g]) => ({ slug, label: topicLabel(g.label), count: g.count }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
}

export function indexedTopics(topics: TopicCount[]): TopicCount[] {
  return topics.filter((t) => t.count >= MIN_INDEXED_TOPIC_REELS)
}

export function buildSitemap(input: {
  reels: ReelSummary[]
  topics: TopicCount[]
  retentionDays: number
  now: Date
}): MetadataRoute.Sitemap {
  const latest = input.reels[0]?.updatedAt ?? input.now.toISOString()
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: latest, changeFrequency: 'hourly', priority: 1 },
    { url: absoluteUrl('/t'), lastModified: latest, changeFrequency: 'daily', priority: 0.6 },
    { url: absoluteUrl('/ask'), changeFrequency: 'weekly', priority: 0.5 },
  ]
  const topics = indexedTopics(input.topics).map((t) => ({
    url: absoluteUrl(`/t/${t.slug}`),
    lastModified: latest,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }))
  const reels = input.reels.map((r) => {
    const entry: MetadataRoute.Sitemap[number] = {
      url: absoluteUrl(reelPath(r)),
      lastModified: r.updatedAt,
      changeFrequency: 'monthly',
      priority: 0.8,
    }
    if (r.posterUrl) entry.images = [r.posterUrl]
    if (r.videoUrl && r.posterUrl) {
      entry.videos = [
        {
          title: r.title.slice(0, 100),
          thumbnail_loc: r.posterUrl,
          description: metaDescription(r.tldr, r.title),
          content_loc: r.videoUrl,
          duration: r.durationMs ? Math.round(r.durationMs / 1000) : undefined,
          publication_date: r.updatedAt,
          expiration_date: new Date(
            new Date(r.updatedAt).getTime() + input.retentionDays * DAY_MS,
          ).toISOString(),
          family_friendly: 'yes',
        },
      ]
    }
    return entry
  })
  return [...pages, ...topics, ...reels]
}

function reelLine(r: ReelSummary): string {
  const summary = r.tldr ? `: ${metaDescription(r.tldr)}` : ''
  return `- [${r.title.replace(/[[\]]/g, '')}](${absoluteUrl(reelPath(r))})${summary}`
}

/** /llms.txt (llmstxt.org): what the site is and where its content lives, as markdown. */
export function buildLlmsTxt(input: { reels: ReelSummary[]; topics: TopicCount[] }): string {
  const topics = indexedTopics(input.topics).slice(0, 40)
  return [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_TAGLINE} ${SITE_SUMMARY}`,
    '',
    'Each reel page has the video, a TL;DR, the full narration transcript, key facts with the ' +
      'sources they come from, and links to the original GitHub repo, thread, video, paper or article.',
    '',
    '## Main pages',
    '',
    `- [Feed](${absoluteUrl('/')}): the latest reels, newest developer stories first`,
    `- [Topics](${absoluteUrl('/t')}): every topic with its reels`,
    `- [Ask](${absoluteUrl('/ask')}): questions answered from the reels with cited sources`,
    `- [Full text](${absoluteUrl('/llms-full.txt')}): summaries and transcripts of recent reels`,
    '',
    '## Topics',
    '',
    ...topics.map((t) => `- [${t.label}](${absoluteUrl(topicPath(t.label))}): ${t.count} reels`),
    '',
    '## Latest reels',
    '',
    ...input.reels.map(reelLine),
    '',
  ].join('\n')
}

/** /llms-full.txt: recent reels with their summary and transcript inline. */
export function buildLlmsFullTxt(
  reels: (ReelSummary & { transcript: string | null; sourceUrl: string })[],
): string {
  const blocks = reels.map((r) =>
    [
      `## ${r.title}`,
      '',
      `URL: ${absoluteUrl(reelPath(r))}`,
      `Source: ${r.sourceUrl}`,
      `Published: ${r.publishedAt.slice(0, 10)}`,
      r.topics.length ? `Topics: ${r.topics.join(', ')}` : '',
      '',
      r.tldr ? `TL;DR: ${r.tldr}` : '',
      r.transcript ? `\nTranscript: ${r.transcript}` : '',
    ]
      .filter((line, i, all) => line !== '' || all[i - 1] !== '')
      .join('\n')
      .trim(),
  )
  return [`# ${SITE_NAME}: recent reels\n\n> ${SITE_SUMMARY}`, ...blocks, ''].join('\n\n')
}
