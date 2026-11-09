import { errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import { COMMENT_FIELDS, POST_FIELDS, REDDIT_MIN_COMMENTS_FOR_TREE } from '../config'
import { stripHtml, truncate } from '../html'
import type { AdapterOutcome, FetchContext, NormalizedMention, SourceAdapter } from '../types'
import { arcticGet } from './arctic-shift'

const PAGE_LIMIT = 100
const MAX_TREE_FETCHES = 10
const TOP_COMMENTS = 5
const COMMENT_CHARS = 600

export const postSchema = z.looseObject({
  id: z.string().min(1),
  created_utc: z.number(),
  title: z.string().nullish(),
  selftext: z.string().nullish(),
  author: z.string().nullish(),
  score: z.number().nullish(),
  num_comments: z.number().nullish(),
  subreddit: z.string().nullish(),
  url: z.string().nullish(),
  over_18: z.boolean().nullish(),
})

export const commentSchema = z.looseObject({
  id: z.string().min(1),
  created_utc: z.number(),
  body: z.string().nullish(),
  author: z.string().nullish(),
  score: z.number().nullish(),
})

export type RedditPost = z.infer<typeof postSchema>
export type RedditComment = z.infer<typeof commentSchema>

const postListSchema = z.array(postSchema)

export function permalink(subreddit: string | null | undefined, id: string): string {
  return `https://www.reddit.com/r/${subreddit ?? 'reddit'}/comments/${id}/`
}

function readable(text: string | null | undefined): string | null {
  const t = text?.trim()
  if (!t || t === '[deleted]' || t === '[removed]') return null
  return t
}

export function postToMention(post: RedditPost, scope: string): NormalizedMention | null {
  if (post.over_18) return null
  const title = readable(post.title)
  if (!title) return null
  const url = permalink(post.subreddit ?? scope, post.id)
  return {
    source: 'reddit',
    externalId: post.id,
    kind: 'post',
    url,
    linkedUrl: post.url && post.url !== url ? post.url : null,
    title,
    author: post.author ?? null,
    body: readable(post.selftext),
    score: post.score ?? null,
    numComments: post.num_comments ?? null,
    publishedAt: new Date(post.created_utc * 1000),
    extraTexts: [],
    facts: { subreddit: post.subreddit ?? scope },
  }
}

export function flattenTree(nodes: unknown, out: RedditComment[]): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const record = node as Record<string, unknown>
    if (record.kind === 'more') continue
    const data = (record.data ?? record) as Record<string, unknown>
    const parsed = commentSchema.safeParse(data)
    if (parsed.success) out.push(parsed.data)
    const replies = data.replies as Record<string, unknown> | undefined
    const children =
      (replies?.data as Record<string, unknown> | undefined)?.children ?? replies ?? []
    flattenTree(children, out)
  }
}

export function topCommentTexts(comments: readonly RedditComment[]): string[] {
  return comments
    .map((c) => ({ text: readable(c.body), score: c.score ?? 0 }))
    .filter((c): c is { text: string; score: number } => c.text !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_COMMENTS)
    .map((c) => truncate(stripHtml(c.text), COMMENT_CHARS))
}

export async function fetchTopComments(
  postId: string,
  log: Logger,
  hostIntervalMs: number,
): Promise<string[]> {
  const raw = await arcticGet<unknown>(
    '/api/comments/tree',
    { link_id: `t3_${postId}`, limit: '200' },
    log,
    hostIntervalMs,
  )
  const out: RedditComment[] = []
  flattenTree(Array.isArray(raw) ? raw : [raw], out)
  return topCommentTexts(out)
}

export async function fetchPostsByIds(
  ids: readonly string[],
  log: Logger,
  hostIntervalMs: number,
): Promise<RedditPost[]> {
  if (ids.length === 0) return []
  const raw = await arcticGet<unknown>(
    '/api/posts/ids',
    { ids: ids.join(','), fields: POST_FIELDS },
    log,
    hostIntervalMs,
  )
  return postListSchema.parse(raw)
}

async function fetch(scope: string, log: Logger, ctx: FetchContext): Promise<AdapterOutcome> {
  const l = log.child({ source: 'reddit', scope })
  const after = Math.floor(ctx.range.after.getTime() / 1000)
  let before = ctx.range.before ? Math.floor(ctx.range.before.getTime() / 1000) : null
  const mentions: NormalizedMention[] = []
  const seen = new Set<string>()
  let exhausted = false

  for (let page = 0; page < ctx.maxPages; page++) {
    if (performance.now() > ctx.deadlineAt) {
      l.warn({ page }, 'reddit fetch hit time budget, stopping early')
      break
    }
    const params: Record<string, string> = {
      subreddit: scope,
      after: String(after),
      sort: 'desc',
      limit: String(PAGE_LIMIT),
      fields: POST_FIELDS,
    }
    if (before !== null) params.before = String(before)

    const batch = postListSchema.parse(
      await arcticGet<unknown>('/api/posts/search', params, l, ctx.hostIntervalMs),
    )
    for (const post of batch) {
      if (seen.has(post.id)) continue
      seen.add(post.id)
      const mention = postToMention(post, scope)
      if (mention) mentions.push(mention)
    }
    l.debug({ page, batch: batch.length, total: mentions.length }, 'reddit page')

    if (batch.length < PAGE_LIMIT) {
      exhausted = true
      break
    }
    const oldest = Math.min(...batch.map((p) => p.created_utc))
    if (before !== null && oldest >= before) {
      exhausted = true
      break
    }
    before = oldest
  }

  const withComments = mentions
    .filter((m) => (m.numComments ?? 0) >= REDDIT_MIN_COMMENTS_FOR_TREE)
    .sort((a, b) => (b.numComments ?? 0) - (a.numComments ?? 0))
    .slice(0, MAX_TREE_FETCHES)
  for (const mention of withComments) {
    if (performance.now() > ctx.deadlineAt) break
    try {
      mention.extraTexts = await fetchTopComments(mention.externalId, l, ctx.hostIntervalMs)
    } catch (err) {
      l.warn({ post: mention.externalId, ...errorFields(err) }, 'reddit comment tree failed')
    }
  }

  l.info({ mentions: mentions.length, exhausted }, 'reddit fetch complete')
  return { mentions, exhausted }
}

export const redditAdapter: SourceAdapter = {
  source: 'reddit',
  scopes: (settings) => settings.redditSubreddits,
  fetch,
}
