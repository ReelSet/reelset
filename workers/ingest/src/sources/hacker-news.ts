import { errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import { attachArticleText } from '../article'
import {
  HN_ALGOLIA_BASE,
  HN_HITS_PER_PAGE,
  HN_MAX_ARTICLE_FETCHES,
  HN_MAX_COMMENT_FETCHES,
  HN_MIN_POINTS,
} from '../config'
import { fetchJson } from '../http'
import { stripHtml, truncate } from '../html'
import type { AdapterOutcome, FetchContext, NormalizedMention, SourceAdapter } from '../types'

const TOP_COMMENTS = 5
const COMMENT_CHARS = 600

export const hitSchema = z.looseObject({
  objectID: z.string().min(1),
  title: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string().nullish(),
  points: z.number().nullish(),
  num_comments: z.number().nullish(),
  created_at_i: z.number(),
  story_text: z.string().nullish(),
})

const searchSchema = z.looseObject({
  hits: z.array(hitSchema),
  nbPages: z.number().nullish(),
})

export type HnHit = z.infer<typeof hitSchema>

const itemSchema = z.looseObject({
  text: z.string().nullish(),
  children: z.array(z.unknown()).nullish(),
})

export function hitToMention(hit: HnHit): NormalizedMention | null {
  const title = hit.title?.trim()
  if (!title) return null
  const storyText = hit.story_text ? stripHtml(hit.story_text) : null
  return {
    source: 'hn',
    externalId: hit.objectID,
    kind: 'post',
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    linkedUrl: hit.url?.trim() || null,
    title,
    author: hit.author ?? null,
    body: storyText || null,
    score: hit.points ?? null,
    numComments: hit.num_comments ?? null,
    publishedAt: new Date(hit.created_at_i * 1000),
    extraTexts: [],
  }
}

export function topLevelComments(item: unknown): string[] {
  const parsed = itemSchema.safeParse(item)
  if (!parsed.success) return []
  const out: string[] = []
  for (const child of parsed.data.children ?? []) {
    const c = itemSchema.safeParse(child)
    if (!c.success || !c.data.text) continue
    const text = stripHtml(c.data.text)
    if (text) out.push(truncate(text, COMMENT_CHARS))
    if (out.length >= TOP_COMMENTS) break
  }
  return out
}

function searchUrl(ctx: FetchContext, page: number): string {
  const after = Math.floor(ctx.range.after.getTime() / 1000)
  const filters = [`created_at_i>${after}`, `points>=${HN_MIN_POINTS}`]
  if (ctx.range.before)
    filters.push(`created_at_i<${Math.floor(ctx.range.before.getTime() / 1000)}`)
  const params = new URLSearchParams({
    tags: 'story',
    numericFilters: filters.join(','),
    hitsPerPage: String(HN_HITS_PER_PAGE),
    page: String(page),
  })
  return `${HN_ALGOLIA_BASE}/search_by_date?${params.toString()}`
}

async function fetchStories(
  scope: string,
  log: Logger,
  ctx: FetchContext,
): Promise<AdapterOutcome> {
  const l = log.child({ source: 'hn', scope })
  const mentions: NormalizedMention[] = []
  const seen = new Set<string>()
  let exhausted = false

  for (let page = 0; page < ctx.maxPages; page++) {
    if (performance.now() > ctx.deadlineAt) {
      l.warn({ page }, 'hn fetch hit time budget, stopping early')
      break
    }
    const response = searchSchema.parse(
      await fetchJson(searchUrl(ctx, page), l, { hostIntervalMs: ctx.hostIntervalMs }),
    )
    for (const hit of response.hits) {
      if (seen.has(hit.objectID)) continue
      seen.add(hit.objectID)
      const mention = hitToMention(hit)
      if (mention) mentions.push(mention)
    }
    l.debug({ page, hits: response.hits.length, total: mentions.length }, 'hn page')

    const lastPage =
      response.nbPages !== undefined && response.nbPages !== null && page + 1 >= response.nbPages
    if (response.hits.length < HN_HITS_PER_PAGE || lastPage) {
      exhausted = true
      break
    }
  }

  const hottest = mentions
    .filter((m) => (m.numComments ?? 0) > 0)
    .sort((a, b) => (b.numComments ?? 0) - (a.numComments ?? 0))
    .slice(0, HN_MAX_COMMENT_FETCHES)
  for (const mention of hottest) {
    if (performance.now() > ctx.deadlineAt) break
    try {
      const item = await fetchJson(`${HN_ALGOLIA_BASE}/items/${mention.externalId}`, l, {
        hostIntervalMs: ctx.hostIntervalMs,
      })
      mention.extraTexts = topLevelComments(item)
      const topComment = mention.extraTexts[0]
      if (topComment) mention.facts = { ...mention.facts, topComment }
    } catch (err) {
      l.warn({ story: mention.externalId, ...errorFields(err) }, 'hn comments fetch failed')
    }
  }

  await attachArticleText(mentions, HN_MAX_ARTICLE_FETCHES, l, ctx)

  l.info({ mentions: mentions.length, exhausted }, 'hn fetch complete')
  return { mentions, exhausted }
}

export const hackerNewsAdapter: SourceAdapter = {
  source: 'hn',
  scopes: () => ['stories'],
  rollingWindowMs: 24 * 60 * 60 * 1000,
  fetch: fetchStories,
}
