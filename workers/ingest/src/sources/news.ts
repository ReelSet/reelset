import type { Logger } from '@reelset/core'
import { NEWS_BODY_CHARS, NEWS_MAX_ENTRIES_PER_FEED, USER_AGENT } from '../config'
import { fetchText } from '../http'
import { truncate } from '../html'
import { parseFeed, type FeedEntry } from '../rss'
import type { AdapterOutcome, FetchContext, NormalizedMention, SourceAdapter } from '../types'

export function entryToMention(entry: FeedEntry, range: { after: Date; before: Date | null }) {
  if (!entry.publishedAt) return null
  if (entry.publishedAt <= range.after) return null
  if (range.before && entry.publishedAt >= range.before) return null
  const mention: NormalizedMention = {
    source: 'news',
    externalId: entry.id.slice(0, 128),
    kind: 'article',
    url: entry.link,
    linkedUrl: entry.link,
    title: entry.title,
    author: null,
    body: truncate(entry.text, NEWS_BODY_CHARS) || null,
    score: null,
    numComments: null,
    publishedAt: entry.publishedAt,
    extraTexts: [],
  }
  return mention
}

async function fetchFeed(scope: string, log: Logger, ctx: FetchContext): Promise<AdapterOutcome> {
  const l = log.child({ source: 'news', scope })
  const xml = await fetchText(scope, l, {
    headers: {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      'user-agent': USER_AGENT,
    },
    hostIntervalMs: ctx.hostIntervalMs,
  })
  const entries = parseFeed(xml)
  if (entries.length === 0) l.warn('news feed parsed to zero entries')

  const mentions = entries
    .slice(0, NEWS_MAX_ENTRIES_PER_FEED)
    .map((entry) => entryToMention(entry, ctx.range))
    .filter((m): m is NormalizedMention => m !== null)

  l.info({ entries: entries.length, mentions: mentions.length }, 'news fetch complete')
  return { mentions, exhausted: true }
}

export const newsAdapter: SourceAdapter = {
  source: 'news',
  scopes: (settings) => settings.newsFeeds,
  fetch: fetchFeed,
}
