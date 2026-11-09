import { errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import {
  GITHUB_API_BASE,
  GITHUB_MAX_README_FETCHES,
  GITHUB_MIN_STARS,
  GITHUB_PER_PAGE,
  GITHUB_README_EXCERPT_CHARS,
  USER_AGENT,
} from '../config'
import { HttpError, fetchJson, fetchText } from '../http'
import { truncate } from '../html'
import type { AdapterOutcome, FetchContext, NormalizedMention, SourceAdapter } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

export const repoSchema = z.looseObject({
  id: z.number(),
  full_name: z.string().min(1),
  html_url: z.url(),
  description: z.string().nullish(),
  stargazers_count: z.number(),
  forks_count: z.number().nullish(),
  created_at: z.string(),
  language: z.string().nullish(),
  topics: z.array(z.string()).nullish(),
  fork: z.boolean().nullish(),
  archived: z.boolean().nullish(),
  owner: z.looseObject({ login: z.string() }).nullish(),
})

const searchSchema = z.looseObject({ items: z.array(repoSchema) })

export type GithubRepo = z.infer<typeof repoSchema>

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function buildQuery(range: { after: Date; before: Date | null }): string {
  const parts = [`created:>=${isoDay(range.after)}`, `stars:>=${GITHUB_MIN_STARS}`, 'fork:false']
  if (range.before) parts.push(`created:<${isoDay(new Date(range.before.getTime() + DAY_MS))}`)
  return parts.join(' ')
}

const SPAM_PATTERNS: RegExp[] = [
  /\b(?:crack(?:ed)?|keygen|key-?gen|warez|nulled|activator|serial[\s-]?key|license[\s-]?key|product[\s-]?key|patcher)\b/i,
  /\b(?:monero|crypto|bitcoin|btc|eth)[\s-]?miner\b/i,
  /\b(?:free[\s-]?download|download[\s-]?(?:free|full)|full[\s-]?version|pre-?activated|no[\s-]?survey)\b/i,
  // Paid-software clones: "<commercial product> pro/premium/free/..."
  /\b(?:adobe|acrobat|photoshop|illustrator|premiere|autocad|office|windows|directory[\s-]?opus|idm|winrar|vegas|camtasia|sketchup)[\s-]\S*[\s-]?(?:pro|premium|ultimate|full|free|activated)\b/i,
]
// \b treats _ as a word character, so turn it (and dots) into spaces before matching.
const normalizeForSpam = (text: string): string => text.replace(/[_.]+/g, ' ')

/** Returns why a repo looks like spam, malware bait or cracked software, or null if it looks fine. */
export function spamReason(repo: GithubRepo, now = new Date()): string | null {
  const text = normalizeForSpam(
    [repo.full_name, repo.description ?? '', ...(repo.topics ?? [])].join(' \n '),
  )
  for (const pattern of SPAM_PATTERNS)
    if (pattern.test(text)) return `matches ${pattern.source.slice(0, 40)}`
  if (!repo.description?.trim() && !repo.topics?.length && !repo.language)
    return 'no description, topics or language'
  const ageDays = Math.max((now.getTime() - new Date(repo.created_at).getTime()) / DAY_MS, 0.25)
  // Genuine launches rarely gain thousands of stars with no topics and no description.
  if (repo.stargazers_count / ageDays > 2000 && !repo.description?.trim())
    return 'implausible star velocity'
  return null
}

const README_SPAM =
  /(?:download|get)\s+(?:the\s+)?(?:crack|keygen|full\s+version|activator)|activation\s+(?:key|code)s?|password\s*[:=]\s*\S+|free\s+download/i

export function readmeLooksSpammy(readme: string): boolean {
  return README_SPAM.test(readme)
}

export function repoToMention(repo: GithubRepo): NormalizedMention | null {
  const created = new Date(repo.created_at)
  if (Number.isNaN(created.getTime()) || repo.archived || repo.fork) return null
  const facts = [
    repo.description?.trim(),
    repo.language ? `Language: ${repo.language}` : null,
    repo.topics?.length ? `Topics: ${repo.topics.join(', ')}` : null,
  ].filter(Boolean)
  return {
    source: 'github',
    externalId: String(repo.id),
    kind: 'repo',
    url: repo.html_url,
    linkedUrl: repo.html_url,
    title: repo.full_name,
    author: repo.owner?.login ?? null,
    body: facts.join('\n') || null,
    score: repo.stargazers_count,
    numComments: null,
    publishedAt: created,
    extraTexts: [],
    facts: {
      owner: repo.owner?.login ?? repo.full_name.split('/')[0],
      name: repo.full_name.split('/')[1] ?? repo.full_name,
      description: repo.description?.trim() || null,
      forks: repo.forks_count ?? null,
      language: repo.language ?? null,
      topics: repo.topics?.length ? repo.topics.slice(0, 8) : null,
    },
  }
}

const releaseSchema = z.looseObject({
  tag_name: z.string().min(1),
  published_at: z.string().nullish(),
})

export async function fetchLatestRelease(
  fullName: string,
  token: string | undefined,
  log: Logger,
  hostIntervalMs: number,
): Promise<{ tag: string; publishedAt: string | null } | null> {
  try {
    const json = await fetchJson(`${GITHUB_API_BASE}/repos/${fullName}/releases/latest`, log, {
      headers: headers(token),
      hostIntervalMs,
    })
    const parsed = releaseSchema.safeParse(json)
    return parsed.success
      ? { tag: parsed.data.tag_name.slice(0, 40), publishedAt: parsed.data.published_at ?? null }
      : null
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null
    throw err
  }
}

function headers(token: string | undefined): Record<string, string> {
  const base: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': USER_AGENT,
  }
  if (token) base.authorization = `Bearer ${token}`
  return base
}

export async function fetchReadme(
  fullName: string,
  token: string | undefined,
  log: Logger,
  hostIntervalMs: number,
): Promise<string | null> {
  try {
    const text = await fetchText(`${GITHUB_API_BASE}/repos/${fullName}/readme`, log, {
      headers: { ...headers(token), accept: 'application/vnd.github.raw+json' },
      hostIntervalMs,
    })
    return (
      truncate(text.replace(/<!--[\s\S]*?-->/g, '').trim(), GITHUB_README_EXCERPT_CHARS) || null
    )
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null
    throw err
  }
}

async function fetchRepos(scope: string, log: Logger, ctx: FetchContext): Promise<AdapterOutcome> {
  const l = log.child({ source: 'github', scope })
  const mentions: NormalizedMention[] = []
  const seen = new Set<number>()
  let exhausted = false

  for (let page = 1; page <= ctx.maxPages; page++) {
    if (performance.now() > ctx.deadlineAt) {
      l.warn({ page }, 'github fetch hit time budget, stopping early')
      break
    }
    const params = new URLSearchParams({
      q: buildQuery(ctx.range),
      sort: 'stars',
      order: 'desc',
      per_page: String(GITHUB_PER_PAGE),
      page: String(page),
    })
    const response = searchSchema.parse(
      await fetchJson(`${GITHUB_API_BASE}/search/repositories?${params.toString()}`, l, {
        headers: headers(ctx.githubToken),
        hostIntervalMs: ctx.hostIntervalMs,
      }),
    )
    for (const repo of response.items) {
      if (seen.has(repo.id)) continue
      seen.add(repo.id)
      const reason = spamReason(repo, ctx.now)
      if (reason) {
        l.info({ repo: repo.full_name, reason }, 'github repo skipped as spam')
        continue
      }
      const mention = repoToMention(repo)
      if (mention) mentions.push(mention)
    }
    l.debug({ page, items: response.items.length, total: mentions.length }, 'github page')
    if (response.items.length < GITHUB_PER_PAGE) {
      exhausted = true
      break
    }
  }

  const spam = new Set<NormalizedMention>()
  for (const mention of mentions.slice(0, GITHUB_MAX_README_FETCHES)) {
    if (performance.now() > ctx.deadlineAt) break
    try {
      const readme = await fetchReadme(mention.title, ctx.githubToken, l, ctx.hostIntervalMs)
      if (readme && readmeLooksSpammy(readme)) {
        l.info({ repo: mention.title }, 'github repo skipped, spammy readme')
        spam.add(mention)
      } else if (readme) mention.extraTexts = [readme]
    } catch (err) {
      l.warn({ repo: mention.title, ...errorFields(err) }, 'github readme fetch failed')
    }
    if (spam.has(mention)) continue
    try {
      const release = await fetchLatestRelease(
        mention.title,
        ctx.githubToken,
        l,
        ctx.hostIntervalMs,
      )
      if (release) {
        mention.facts = {
          ...mention.facts,
          latestRelease: release.tag,
          latestReleaseAt: release.publishedAt,
        }
      }
    } catch (err) {
      l.warn({ repo: mention.title, ...errorFields(err) }, 'github release fetch failed')
    }
  }

  const kept = mentions.filter((m) => !spam.has(m))
  l.info({ mentions: kept.length, exhausted }, 'github fetch complete')
  return { mentions: kept, exhausted }
}

export const githubAdapter: SourceAdapter = {
  source: 'github',
  scopes: () => ['trending-new'],
  rollingWindowMs: 7 * DAY_MS,
  fetch: fetchRepos,
}
