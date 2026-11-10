import { errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import { GITHUB_API_BASE, HN_ALGOLIA_BASE, USER_AGENT } from './config'
import { stripHtml, truncate } from './html'
import { fetchJson } from './http'
import { fetchReadme } from './sources/github'
import { fetchTopComments, permalink } from './sources/reddit'
import type { ScrapeFallback } from './types'
import type { BriefComment, GithubExtras, Supplements } from './pipeline/brief'

const COMMENT_FETCH_CHARS = 420
const MAX_FETCHED_COMMENTS = 5

const hnItemSchema = z.looseObject({
  author: z.string().nullish(),
  text: z.string().nullish(),
  points: z.number().nullish(),
  children: z.array(z.unknown()).nullish(),
})

export function parseHnComments(item: unknown, max = MAX_FETCHED_COMMENTS): BriefComment[] {
  const parsed = hnItemSchema.safeParse(item)
  if (!parsed.success) return []
  const out: BriefComment[] = []
  for (const child of parsed.data.children ?? []) {
    const c = hnItemSchema.safeParse(child)
    if (!c.success || !c.data.text) continue
    const text = truncate(stripHtml(c.data.text), COMMENT_FETCH_CHARS)
    if (text.length < 20) continue
    out.push({ author: c.data.author ?? null, score: c.data.points ?? null, text })
    if (out.length >= max) break
  }
  return out
}

/** Top-level comments in HN rank order from the Algolia items API. Never throws. */
export async function fetchHnComments(storyId: string, log: Logger): Promise<BriefComment[]> {
  try {
    const item = await fetchJson(`${HN_ALGOLIA_BASE}/items/${storyId}`, log, { hostIntervalMs: 0 })
    return parseHnComments(item)
  } catch (err) {
    log.warn({ storyId, ...errorFields(err) }, 'hn comments fetch failed')
    return []
  }
}

type Listing = { data?: { children?: { kind?: string; data?: Record<string, unknown> }[] } }

export function parseRedditComments(json: unknown, max = MAX_FETCHED_COMMENTS): BriefComment[] {
  const listing = (Array.isArray(json) ? json[1] : null) as Listing | null
  const out: BriefComment[] = []
  for (const child of listing?.data?.children ?? []) {
    if (child.kind !== 't1' || !child.data) continue
    const body = typeof child.data.body === 'string' ? child.data.body.trim() : ''
    if (!body || body === '[deleted]' || body === '[removed]' || body.length < 20) continue
    out.push({
      author: typeof child.data.author === 'string' ? child.data.author : null,
      score: typeof child.data.score === 'number' ? child.data.score : null,
      text: truncate(stripHtml(body), COMMENT_FETCH_CHARS),
    })
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, max)
}

/** Direct fetch of the post's .json first, then Arctic Shift; Firecrawl only as the last resort. */
export async function fetchRedditComments(
  postId: string,
  subreddit: string | null,
  log: Logger,
  scrape?: ScrapeFallback,
): Promise<BriefComment[]> {
  const url = `${permalink(subreddit, postId)}.json?limit=40&sort=top&raw_json=1`
  try {
    return parseRedditComments(
      await fetchJson(url, log, { headers: { 'user-agent': USER_AGENT }, attempts: 1 }),
    )
  } catch (err) {
    log.warn({ postId, ...errorFields(err) }, 'reddit comments direct fetch failed')
  }
  try {
    const texts = await fetchTopComments(postId, log, 0)
    if (texts.length > 0) return texts.map((text) => ({ author: null, score: null, text }))
  } catch (err) {
    log.warn({ postId, ...errorFields(err) }, 'reddit comments arctic fetch failed')
  }
  if (!scrape) return []
  try {
    const text = await scrape.scrape(url, 'reddit_comments')
    return text ? parseRedditComments(JSON.parse(text.replace(/^```(?:json)?|```$/gm, ''))) : []
  } catch (err) {
    log.warn({ postId, ...errorFields(err) }, 'reddit comments scrape fallback failed')
    return []
  }
}

const repoDetailSchema = z.looseObject({
  stargazers_count: z.number().nullish(),
  forks_count: z.number().nullish(),
  language: z.string().nullish(),
  topics: z.array(z.string()).nullish(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
})

const releaseDetailSchema = z.looseObject({
  tag_name: z.string(),
  name: z.string().nullish(),
  body: z.string().nullish(),
  published_at: z.string().nullish(),
})

/** Repo stats, latest release notes and the README straight from the GitHub API. Never throws. */
export async function fetchGithubExtras(
  fullName: string,
  token: string | undefined,
  log: Logger,
): Promise<GithubExtras> {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': USER_AGENT,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
  const out: GithubExtras = {}
  try {
    const repo = repoDetailSchema.parse(
      await fetchJson(`${GITHUB_API_BASE}/repos/${fullName}`, log, { headers, hostIntervalMs: 0 }),
    )
    Object.assign(out, {
      stars: repo.stargazers_count ?? null,
      forks: repo.forks_count ?? null,
      language: repo.language ?? null,
      topics: repo.topics ?? [],
      description: repo.description?.trim() || null,
      createdAt: repo.created_at ?? null,
    })
  } catch (err) {
    log.warn({ fullName, ...errorFields(err) }, 'github repo details fetch failed')
  }
  try {
    const rel = releaseDetailSchema.parse(
      await fetchJson(`${GITHUB_API_BASE}/repos/${fullName}/releases/latest`, log, {
        headers,
        hostIntervalMs: 0,
        attempts: 1,
      }),
    )
    out.release = {
      tag: rel.tag_name.slice(0, 40),
      name: rel.name?.trim() || null,
      body: rel.body ? truncate(stripHtml(rel.body), 500) : null,
      publishedAt: rel.published_at ?? null,
    }
  } catch {
    // no releases is normal
  }
  try {
    out.readme = await fetchReadme(fullName, token, log, 0)
  } catch (err) {
    log.warn({ fullName, ...errorFields(err) }, 'github readme fetch failed')
  }
  return out
}

export type EnrichMention = {
  id: string
  source: string
  externalId: string
  extraTexts: readonly string[]
  facts: Record<string, unknown>
}

export type Enrichment = {
  supplements: Supplements
  /** Extra evidence texts per mention id, appended so every brief fact has a citable chunk. */
  extraTexts: Map<string, string[]>
}

const COMMENTS_ENOUGH = 3
const ARTICLE_LIKE = 650

const commentText = (c: BriefComment): string =>
  `Comment${c.author ? ` by ${c.author}` : ''}: ${c.text}`

function add(map: Map<string, string[]>, id: string, texts: string[]): void {
  if (texts.length > 0) map.set(id, [...(map.get(id) ?? []), ...texts])
}

export type EnrichDeps = {
  log: Logger
  githubToken?: string
  scrape?: ScrapeFallback
}

/**
 * Best-effort live enrichment before generation: HN and Reddit top comments when the stored
 * mention has too few, and GitHub stats, release notes and README when the item came in through a
 * discussion and no GitHub mention carries them. Failures only shrink the brief.
 */
export async function enrichItem(
  canonicalKey: string,
  mentions: readonly EnrichMention[],
  deps: EnrichDeps,
): Promise<Enrichment> {
  const extraTexts = new Map<string, string[]>()
  const comments: Record<string, BriefComment[]> = {}
  for (const m of mentions) {
    if (m.source === 'hn') {
      const have = m.extraTexts.filter((t) => t.length <= ARTICLE_LIKE).length
      if (have >= COMMENTS_ENOUGH) continue
      const fetched = await fetchHnComments(m.externalId, deps.log)
      if (fetched.length > 0) comments[m.externalId] = fetched
      add(extraTexts, m.id, fetched.map(commentText))
    } else if (m.source === 'reddit') {
      if (m.extraTexts.length >= COMMENTS_ENOUGH) continue
      const sub = typeof m.facts.subreddit === 'string' ? m.facts.subreddit : null
      const fetched = await fetchRedditComments(m.externalId, sub, deps.log, deps.scrape)
      if (fetched.length > 0) comments[m.externalId] = fetched
      add(extraTexts, m.id, fetched.map(commentText))
    }
  }
  let github: GithubExtras | undefined
  const repo = canonicalKey.startsWith('github:') ? canonicalKey.slice('github:'.length) : null
  const ghMention = mentions.find((m) => m.source === 'github')
  if (repo) {
    github = await fetchGithubExtras(repo, deps.githubToken, deps.log)
    const host = ghMention ?? mentions[0]
    if (host) {
      const needsBase = !ghMention?.extraTexts[0]
      const stats = [
        github.stars != null ? `${github.stars.toLocaleString('en-US')} stars` : null,
        github.forks != null ? `${github.forks.toLocaleString('en-US')} forks` : null,
        github.language ?? null,
      ].filter(Boolean)
      const release = github.release?.body
        ? `Release ${github.release.tag}${github.release.name ? ` "${github.release.name}"` : ''}: ${github.release.body}`
        : null
      add(extraTexts, host.id, [
        ...(needsBase && (github.description || stats.length > 0)
          ? [`Repository ${repo}: ${github.description ?? ''} (${stats.join(', ')})`.trim()]
          : []),
        ...(needsBase && github.readme ? [github.readme] : []),
        ...(release ? [release] : []),
      ])
    }
  }
  return { supplements: { comments, github }, extraTexts }
}
