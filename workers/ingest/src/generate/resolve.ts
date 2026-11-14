import { errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import { articleUrlFor, attachArticleText, extractArticleText, fetchPageText } from '../article'
import { canonicalizeUrl } from '../canonical'
import { ARCTIC_HOST_INTERVAL_MS, ARXIV_API_URL, USER_AGENT } from '../config'
import { HttpError, fetchJson, fetchText } from '../http'
import { decodeEntities, truncate } from '../html'
import { paperEvidenceText, parseArxivFeed } from '../sources/papers'
import {
  fetchLatestRelease,
  fetchReadme,
  githubHeaders,
  repoSchema,
  repoToMention,
} from '../sources/github'
import { hitToMention, topLevelComments } from '../sources/hacker-news'
import { fetchPostsByIds, fetchTopComments, postToMention } from '../sources/reddit'
import { HN_ALGOLIA_BASE, GITHUB_API_BASE } from '../config'
import type { NormalizedMention, ScrapeFallback } from '../types'
import { isBlockedHost } from './hosts'

export type ResolveDeps = {
  log: Logger
  githubToken?: string
  scrape?: ScrapeFallback
  now?: () => Date
}

export type ResolveResult =
  { ok: true; mention: NormalizedMention } | { ok: false; message: string }

export const MESSAGES = {
  invalid: 'That is not a valid web link. Use a full http or https address.',
  blocked: 'That link points to a private or local address, so we cannot read it.',
  unsupported: 'We could not recognize that link. Paste a public page, repo, video or paper.',
  unreadable: 'We could not read that page. It may be private, blocked or down.',
  githubMissing: 'We could not find that GitHub repository. It may be private or renamed.',
  hnMissing: 'We could not find that Hacker News post.',
  hnNotStory: 'That Hacker News link is a comment. Paste the link to the story itself.',
  redditMissing:
    'We could not read that Reddit post. It may be deleted, adult, or too new to be available yet.',
  youtubeMissing: 'We could not read that YouTube video. It may be private or unavailable.',
  paperMissing: 'We could not find that arXiv paper.',
} as const

const HN_HOSTS = new Set(['news.ycombinator.com'])
const REDDIT_HOSTS = new Set(['reddit.com', 'old.reddit.com', 'np.reddit.com', 'new.reddit.com'])
const REDDIT_POST = /^\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)/i
const SKIP_EXT = /\.(?:png|jpe?g|gif|webp|mp4|zip|pdf)$/i

export type SourceRef =
  | { kind: 'hn'; id: string }
  | { kind: 'reddit'; id: string }
  | { kind: 'github'; fullName: string }
  | { kind: 'youtube'; id: string }
  | { kind: 'arxiv'; id: string }
  | { kind: 'article'; url: string }

export type Classified = { ok: true; ref: SourceRef } | { ok: false; message: string }

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

export function classifyUrl(raw: string): Classified {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, message: MESSAGES.invalid }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: MESSAGES.invalid }
  }
  if (isBlockedHost(url.hostname)) return { ok: false, message: MESSAGES.blocked }

  const host = stripWww(url.hostname)
  if (HN_HOSTS.has(host)) {
    const id = url.searchParams.get('id')
    return url.pathname === '/item' && id && /^\d+$/.test(id)
      ? { ok: true, ref: { kind: 'hn', id } }
      : { ok: false, message: MESSAGES.unsupported }
  }
  if (REDDIT_HOSTS.has(host) || host === 'redd.it') {
    const id =
      host === 'redd.it'
        ? url.pathname.split('/').filter(Boolean)[0]
        : REDDIT_POST.exec(url.pathname)?.[1]
    return id && /^[a-z0-9]+$/i.test(id)
      ? { ok: true, ref: { kind: 'reddit', id: id.toLowerCase() } }
      : { ok: false, message: MESSAGES.unsupported }
  }

  const target = canonicalizeUrl(raw)
  if (!target) return { ok: false, message: MESSAGES.unsupported }
  const key = target.canonicalKey
  if (key.startsWith('github:')) {
    return { ok: true, ref: { kind: 'github', fullName: key.slice('github:'.length) } }
  }
  if (key.startsWith('youtube:')) {
    return { ok: true, ref: { kind: 'youtube', id: key.slice('youtube:'.length) } }
  }
  if (key.startsWith('arxiv:')) {
    return { ok: true, ref: { kind: 'arxiv', id: key.slice('arxiv:'.length) } }
  }
  if (SKIP_EXT.test(url.pathname)) return { ok: false, message: MESSAGES.unsupported }
  return { ok: true, ref: { kind: 'article', url: target.canonicalUrl } }
}

function pageTitle(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)
  const raw = og?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const title = raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() : ''
  return title || null
}

function fallbackTitle(url: string, markdown: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim()
  if (heading) return heading.slice(0, 200)
  const u = new URL(url)
  return `${stripWww(u.hostname)}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 200)
}

async function resolveGithub(fullName: string, deps: ResolveDeps): Promise<ResolveResult> {
  const { log } = deps
  try {
    const json = await fetchJson(`${GITHUB_API_BASE}/repos/${fullName}`, log, {
      headers: githubHeaders(deps.githubToken),
      hostIntervalMs: 0,
    })
    const parsed = repoSchema.safeParse(json)
    if (!parsed.success) return { ok: false, message: MESSAGES.githubMissing }
    const mention = repoToMention({ ...parsed.data, archived: false, fork: false })
    if (!mention) return { ok: false, message: MESSAGES.githubMissing }
    try {
      const readme = await fetchReadme(parsed.data.full_name, deps.githubToken, log, 0)
      if (readme) mention.extraTexts = [readme]
      const release = await fetchLatestRelease(parsed.data.full_name, deps.githubToken, log, 0)
      if (release) {
        mention.facts = {
          ...mention.facts,
          latestRelease: release.tag,
          latestReleaseAt: release.publishedAt,
        }
      }
    } catch (err) {
      log.warn(errorFields(err), 'github enrichment failed, continuing with repo metadata')
    }
    return { ok: true, mention }
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 451)) {
      return { ok: false, message: MESSAGES.githubMissing }
    }
    log.warn(errorFields(err), 'github repo fetch failed')
    return { ok: false, message: MESSAGES.unreadable }
  }
}

const hnItemSchema = z.looseObject({
  id: z.number(),
  type: z.string().nullish(),
  title: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string().nullish(),
  points: z.number().nullish(),
  text: z.string().nullish(),
  created_at_i: z.number(),
  children: z.array(z.unknown()).nullish(),
})

async function resolveHn(id: string, deps: ResolveDeps): Promise<ResolveResult> {
  const { log } = deps
  try {
    const json = await fetchJson(`${HN_ALGOLIA_BASE}/items/${id}`, log, { hostIntervalMs: 0 })
    const parsed = hnItemSchema.safeParse(json)
    if (!parsed.success) return { ok: false, message: MESSAGES.hnMissing }
    const item = parsed.data
    if (item.type && item.type !== 'story' && item.type !== 'poll') {
      return { ok: false, message: MESSAGES.hnNotStory }
    }
    const mention = hitToMention({
      objectID: String(item.id),
      title: item.title,
      url: item.url,
      author: item.author,
      points: item.points,
      num_comments: item.children?.length ?? 0,
      created_at_i: item.created_at_i,
      story_text: item.text,
    })
    if (!mention) return { ok: false, message: MESSAGES.hnMissing }
    mention.extraTexts = topLevelComments(json)
    await attachLinkedArticle(mention, deps)
    return { ok: true, mention }
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return { ok: false, message: MESSAGES.hnMissing }
    }
    log.warn(errorFields(err), 'hn item fetch failed')
    return { ok: false, message: MESSAGES.unreadable }
  }
}

async function attachLinkedArticle(mention: NormalizedMention, deps: ResolveDeps): Promise<void> {
  if (!articleUrlFor(mention)) return
  await attachArticleText([mention], 1, deps.log, {
    scrape: deps.scrape,
    hostIntervalMs: 0,
    deadlineAt: performance.now() + 60_000,
  })
}

async function resolveReddit(id: string, deps: ResolveDeps): Promise<ResolveResult> {
  const { log } = deps
  try {
    const [post] = await fetchPostsByIds([id], log, ARCTIC_HOST_INTERVAL_MS)
    const mention = post ? postToMention(post, post.subreddit ?? 'reddit') : null
    if (!mention) return { ok: false, message: MESSAGES.redditMissing }
    try {
      mention.extraTexts = await fetchTopComments(id, log, ARCTIC_HOST_INTERVAL_MS)
    } catch (err) {
      log.warn(errorFields(err), 'reddit comments fetch failed, continuing without')
    }
    await attachLinkedArticle(mention, deps)
    return { ok: true, mention }
  } catch (err) {
    log.warn(errorFields(err), 'reddit post fetch failed')
    return { ok: false, message: MESSAGES.redditMissing }
  }
}

const oembedSchema = z.looseObject({
  title: z.string().nullish(),
  author_name: z.string().nullish(),
})

async function resolveYoutube(id: string, deps: ResolveDeps): Promise<ResolveResult> {
  const { log } = deps
  const url = `https://www.youtube.com/watch?v=${id}`
  try {
    const json = await fetchJson(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      log,
      { headers: { 'user-agent': USER_AGENT }, attempts: 2, hostIntervalMs: 0 },
    )
    const meta = oembedSchema.parse(json)
    return {
      ok: true,
      mention: {
        source: 'youtube',
        externalId: id,
        kind: 'video',
        url,
        linkedUrl: url,
        title: meta.title?.trim() || `YouTube video ${id}`,
        author: meta.author_name ?? null,
        body: null,
        score: null,
        numComments: null,
        publishedAt: (deps.now ?? (() => new Date()))(),
        extraTexts: [],
        facts: { channel: meta.author_name ?? null },
      },
    }
  } catch (err) {
    if (err instanceof HttpError && [400, 401, 403, 404].includes(err.status)) {
      return { ok: false, message: MESSAGES.youtubeMissing }
    }
    log.warn(errorFields(err), 'youtube oembed failed')
    return { ok: false, message: MESSAGES.unreadable }
  }
}

async function resolveArxiv(id: string, deps: ResolveDeps): Promise<ResolveResult> {
  const { log } = deps
  try {
    const xml = await fetchText(`${ARXIV_API_URL}?id_list=${encodeURIComponent(id)}`, log, {
      headers: { 'user-agent': USER_AGENT },
      hostIntervalMs: 0,
    })
    const mention = parseArxivFeed(xml)[0]
    if (!mention) return { ok: false, message: MESSAGES.paperMissing }
    const page = await fetchPageText(`https://arxiv.org/html/${id}`, log, {
      scrape: deps.scrape,
      extract: paperEvidenceText,
      minChars: 600,
      hostIntervalMs: 0,
    }).catch((err) => {
      log.warn(errorFields(err), 'paper evidence fetch failed, using abstract only')
      return null
    })
    if (page?.text) mention.extraTexts = [page.text]
    return { ok: true, mention }
  } catch (err) {
    log.warn(errorFields(err), 'arxiv fetch failed')
    return { ok: false, message: MESSAGES.unreadable }
  }
}

async function resolveArticle(url: string, deps: ResolveDeps): Promise<ResolveResult> {
  const { log } = deps
  let title: string | null = null
  try {
    const page = await fetchPageText(url, log, {
      scrape: deps.scrape,
      hostIntervalMs: 0,
      extract: (html) => {
        title = pageTitle(html)
        return extractArticleText(html)
      },
    })
    if (!page.text) return { ok: false, message: MESSAGES.unreadable }
    return {
      ok: true,
      mention: {
        source: 'news',
        externalId: url.slice(0, 128),
        kind: 'article',
        url,
        linkedUrl: url,
        title: truncate(title ?? fallbackTitle(url, page.text), 200),
        author: null,
        body: null,
        score: null,
        numComments: null,
        publishedAt: (deps.now ?? (() => new Date()))(),
        extraTexts: [page.text],
      },
    }
  } catch (err) {
    log.warn(errorFields(err), 'article fetch failed')
    return { ok: false, message: MESSAGES.unreadable }
  }
}

export async function resolveSource(rawUrl: string, deps: ResolveDeps): Promise<ResolveResult> {
  const classified = classifyUrl(rawUrl)
  if (!classified.ok) return classified
  const { ref } = classified
  const log = deps.log.child({ sourceKind: ref.kind })
  const d = { ...deps, log }
  switch (ref.kind) {
    case 'github':
      return resolveGithub(ref.fullName, d)
    case 'hn':
      return resolveHn(ref.id, d)
    case 'reddit':
      return resolveReddit(ref.id, d)
    case 'youtube':
      return resolveYoutube(ref.id, d)
    case 'arxiv':
      return resolveArxiv(ref.id, d)
    case 'article':
      return resolveArticle(ref.url, d)
  }
}
