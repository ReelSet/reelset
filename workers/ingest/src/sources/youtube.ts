import type { Logger } from '@reelset/core'
import { z } from 'zod'
import { YOUTUBE_DESCRIPTION_CHARS, YOUTUBE_SEARCH_SCOPE, YOUTUBE_SEARCH_URL } from '../config'
import { truncate } from '../html'
import type { AdapterOutcome, FetchContext, NormalizedMention, SourceAdapter } from '../types'

export const videoSchema = z.looseObject({
  videoId: z.string().min(1),
  title: z.string(),
  channelName: z.string().nullish(),
  url: z.string().nullish(),
  publishedAt: z.string(),
  viewCount: z.number().nullish(),
  durationSec: z.number().nullish(),
  channelId: z.string().nullish(),
  description: z.string().nullish(),
})

const responseSchema = z.discriminatedUnion('status', [
  z.looseObject({
    status: z.literal('ok'),
    videos: z.array(videoSchema),
    failedQueries: z.array(z.string()).nullish(),
  }),
  z.looseObject({ status: z.literal('error'), reason: z.string().nullish() }),
])

export type YoutubeSearchVideo = z.infer<typeof videoSchema>

export function videoToMention(video: YoutubeSearchVideo): NormalizedMention | null {
  const publishedAt = new Date(video.publishedAt)
  if (Number.isNaN(publishedAt.getTime())) return null
  const url = `https://www.youtube.com/watch?v=${video.videoId}`
  return {
    source: 'youtube',
    externalId: video.videoId,
    kind: 'video',
    url,
    linkedUrl: url,
    title: video.title,
    author: video.channelName ?? null,
    body: truncate(video.description?.trim() ?? '', YOUTUBE_DESCRIPTION_CHARS) || null,
    score: video.viewCount ?? null,
    numComments: null,
    publishedAt,
    extraTexts: [],
    facts: {
      channel: video.channelName ?? null,
      durationSec:
        video.durationSec && video.durationSec > 0 ? Math.round(video.durationSec) : null,
    },
  }
}

async function fetchSearch(scope: string, log: Logger, ctx: FetchContext): Promise<AdapterOutcome> {
  const l = log.child({ source: 'youtube', scope })
  if (!ctx.render) throw new Error('RENDER service binding is not available')
  const { youtubeSearchQueries: queries, youtubeMaxAgeDays, youtubeResultsPerQuery } = ctx.settings

  const startedAt = performance.now()
  const res = await ctx.render.fetch(YOUTUBE_SEARCH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      queries,
      maxAgeDays: youtubeMaxAgeDays,
      perQueryLimit: youtubeResultsPerQuery,
    }),
  })
  l.info(
    {
      status: res.status,
      queries: queries.length,
      durationMs: Math.round(performance.now() - startedAt),
    },
    'youtube search service responded',
  )
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`youtube search service returned HTTP ${res.status}: ${detail}`)
  }

  const parsed = responseSchema.parse(await res.json())
  if (parsed.status === 'error') {
    throw new Error(`youtube search service error: ${parsed.reason ?? 'unknown'}`)
  }
  if (parsed.failedQueries?.length) {
    l.warn({ failedQueries: parsed.failedQueries }, 'some youtube search queries failed')
  }

  const mentions: NormalizedMention[] = []
  for (const video of parsed.videos) {
    const mention = videoToMention(video)
    if (!mention) {
      l.warn(
        { videoId: video.videoId, publishedAt: video.publishedAt },
        'youtube video skipped, bad date',
      )
      continue
    }
    if (mention.publishedAt <= ctx.range.after) continue
    if (ctx.range.before && mention.publishedAt >= ctx.range.before) continue
    mentions.push(mention)
  }
  l.info({ videos: parsed.videos.length, mentions: mentions.length }, 'youtube fetch complete')
  return { mentions, exhausted: true }
}

export const youtubeAdapter: SourceAdapter = {
  source: 'youtube',
  // Search is not time-ordered, so the container's maxAgeDays filter is the window, not the watermark.
  rollingWindowMs: 30 * 24 * 60 * 60 * 1000,
  scopes: (settings) => (settings.youtubeSearchQueries.length > 0 ? [YOUTUBE_SEARCH_SCOPE] : []),
  fetch: fetchSearch,
}
