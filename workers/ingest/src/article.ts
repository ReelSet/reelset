import { errorFields, type Logger } from '@reelset/core'
import { ARTICLE_MIN_CHARS, ARTICLE_TEXT_CHARS, ARTICLE_TIMEOUT_MS, USER_AGENT } from './config'
import { HttpError, fetchText } from './http'
import { stripHtml, truncate } from './html'
import { canonicalizeUrl } from './canonical'
import type { FetchContext, NormalizedMention, ScrapeFallback } from './types'

const CHALLENGE =
  /just a moment|cf-chl|captcha|attention required|verify you are (?:a )?human|enable javascript and cookies|access denied|are you a robot/i
const BLOCKED_STATUSES = new Set([401, 403, 429, 451, 503])
const CHALLENGE_MAX_REAL_CHARS = 1500

export function mainContentHtml(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi,
      ' ',
    )
  const pick = (tag: string) => {
    const blocks = [...cleaned.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))]
    return blocks.map((m) => m[1] ?? '').sort((a, b) => b.length - a.length)[0]
  }
  return pick('article') ?? pick('main') ?? pick('body') ?? cleaned
}

export function extractArticleText(html: string): string {
  return stripHtml(mainContentHtml(html))
}

export function looksLikeChallenge(html: string, text: string): boolean {
  return text.length < CHALLENGE_MAX_REAL_CHARS && CHALLENGE.test(html.slice(0, 6000))
}

export type PageText = {
  text: string
  via: 'direct' | 'firecrawl' | 'none'
  fallbackReason: string | null
}

export type PageTextOptions = {
  scrape?: ScrapeFallback
  minChars?: number
  maxChars?: number
  hostIntervalMs?: number
  extract?: (html: string) => string
  /** HTTP statuses that mean the page does not exist, so a paid retry cannot help. */
  definitiveStatuses?: readonly number[]
}

/** Direct fetch first; Firecrawl only on error, a block/challenge page, or thin text. */
export async function fetchPageText(
  url: string,
  log: Logger,
  options: PageTextOptions = {},
): Promise<PageText> {
  const {
    scrape,
    minChars = ARTICLE_MIN_CHARS,
    maxChars = ARTICLE_TEXT_CHARS,
    hostIntervalMs = 200,
    extract = extractArticleText,
    definitiveStatuses = [404, 410],
  } = options
  const l = log.child({ mod: 'page-text', url: url.slice(0, 200) })

  let fallbackReason: string | null = null
  let direct = ''
  try {
    const html = await fetchText(url, l, {
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
      timeoutMs: ARTICLE_TIMEOUT_MS,
      attempts: 1,
      hostIntervalMs,
    })
    direct = extract(html)
    if (looksLikeChallenge(html, direct)) fallbackReason = 'challenge_page'
    else if (direct.length < minChars) fallbackReason = 'thin_text'
  } catch (err) {
    if (err instanceof HttpError) {
      if (definitiveStatuses.includes(err.status)) {
        l.info({ status: err.status }, 'page not available, no fallback')
        return { text: '', via: 'none', fallbackReason: null }
      }
      fallbackReason = BLOCKED_STATUSES.has(err.status)
        ? `blocked_${err.status}`
        : `http_${err.status}`
    } else {
      l.warn(errorFields(err), 'direct page fetch errored')
      fallbackReason = 'fetch_error'
    }
  }

  if (fallbackReason === null) {
    return { text: truncate(direct, maxChars), via: 'direct', fallbackReason: null }
  }
  if (fallbackReason === 'challenge_page') direct = ''

  if (!scrape) {
    l.info({ reason: fallbackReason }, 'direct fetch insufficient, no fallback configured')
    return { text: truncate(direct, maxChars), via: direct ? 'direct' : 'none', fallbackReason }
  }
  l.info(
    { reason: fallbackReason, directChars: direct.length },
    'direct fetch insufficient, using firecrawl',
  )
  const scraped = await scrape.scrape(url, fallbackReason)
  if (scraped && scraped.length > direct.length) {
    return { text: truncate(scraped, maxChars), via: 'firecrawl', fallbackReason }
  }
  return { text: truncate(direct, maxChars), via: direct ? 'direct' : 'none', fallbackReason }
}

const SKIP_EXT = /\.(?:pdf|png|jpe?g|gif|webp|mp4|zip)(?:[?#].*)?$/i

export function articleUrlFor(mention: NormalizedMention): string | null {
  const url = mention.linkedUrl ?? (mention.source === 'news' ? mention.url : null)
  if (!url || SKIP_EXT.test(url)) return null
  const target = canonicalizeUrl(url)
  return target?.kind === 'article' && !target.canonicalKey.startsWith('arxiv:') ? url : null
}

/** Adds fetched article text to the best candidates, highest score first, within a fetch budget. */
export async function attachArticleText(
  candidates: NormalizedMention[],
  limit: number,
  log: Logger,
  ctx: Pick<FetchContext, 'scrape' | 'hostIntervalMs' | 'deadlineAt'>,
): Promise<void> {
  const picked = candidates
    .map((m) => ({ mention: m, url: articleUrlFor(m) }))
    .filter((c): c is { mention: NormalizedMention; url: string } => c.url !== null)
    .sort((a, b) => (b.mention.score ?? 0) - (a.mention.score ?? 0))
    .slice(0, limit)
  for (const { mention, url } of picked) {
    if (performance.now() > ctx.deadlineAt) break
    try {
      const page = await fetchPageText(url, log, {
        scrape: ctx.scrape,
        hostIntervalMs: ctx.hostIntervalMs,
      })
      if (page.text) mention.extraTexts = [page.text, ...mention.extraTexts]
      log.debug({ url: url.slice(0, 120), via: page.via, chars: page.text.length }, 'article text')
    } catch (err) {
      log.warn({ url: url.slice(0, 120), ...errorFields(err) }, 'article text fetch failed')
    }
  }
}
