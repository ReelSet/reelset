import type { Source } from '@reelset/core'

export type ItemFacts = {
  repo?: {
    owner?: string
    name?: string
    description?: string
    stars?: number
    forks?: number
    language?: string
    topics?: string[]
    latestRelease?: string
  }
  hn?: { points?: number; comments?: number; author?: string; topComment?: string }
  reddit?: { subreddit?: string; upvotes?: number; comments?: number; author?: string }
  youtube?: { channel?: string; views?: number; duration?: string }
  paper?: { authors?: string[]; abstract?: string; upvotes?: number }
  article?: { site?: string; author?: string }
}

export type MentionForFacts = {
  source: Source
  url: string
  title: string | null
  author: string | null
  score: number | null
  numComments: number | null
  raw: unknown
}

type Bag = Record<string, unknown>

const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v)

function rawFacts(raw: unknown): Bag {
  return isBag(raw) && isBag(raw.facts) ? raw.facts : {}
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined

function strings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.flatMap((x) => (str(x) ? [str(x)!] : []))
  return out.length > 0 ? out : undefined
}

export function formatDuration(seconds: unknown): string | undefined {
  const total = count(seconds)
  if (!total) return undefined
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function compact<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined)
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

const NON_ARTICLE_HOSTS =
  /^(?:github\.com|youtube\.com|m\.youtube\.com|youtu\.be|arxiv\.org|news\.ycombinator\.com|reddit\.com|old\.reddit\.com)$/

function repoFacts(m: MentionForFacts): ItemFacts['repo'] {
  const f = rawFacts(m.raw)
  const [ownerFromTitle, nameFromTitle] = (m.title ?? '').split('/')
  return compact({
    owner: str(f.owner) ?? str(ownerFromTitle) ?? str(m.author),
    name: str(f.name) ?? str(nameFromTitle),
    description: str(f.description),
    stars: count(m.score),
    forks: count(f.forks),
    language: str(f.language),
    topics: strings(f.topics),
    latestRelease: str(f.latestRelease),
  })
}

/** Builds the render `facts` body from stored mentions only; a field that is not stored is omitted. */
export function buildFacts(mentions: readonly MentionForFacts[], canonicalUrl: string): ItemFacts {
  const facts: ItemFacts = {}
  for (const m of mentions) {
    const f = rawFacts(m.raw)
    if (m.source === 'github' && !facts.repo) facts.repo = repoFacts(m)
    else if (m.source === 'hn' && !facts.hn) {
      facts.hn = compact({
        points: count(m.score),
        comments: count(m.numComments),
        author: str(m.author),
        topComment: str(f.topComment),
      })
    } else if (m.source === 'reddit' && !facts.reddit) {
      facts.reddit = compact({
        subreddit: str(f.subreddit) ?? /\/r\/([A-Za-z0-9_]+)\//.exec(m.url)?.[1],
        upvotes: count(m.score),
        comments: count(m.numComments),
        author: str(m.author),
      })
    } else if (m.source === 'youtube' && !facts.youtube) {
      facts.youtube = compact({
        channel: str(m.author) ?? str(f.channel),
        views: count(m.score),
        duration: formatDuration(f.durationSec),
      })
    } else if (m.source === 'papers' && !facts.paper) {
      facts.paper = compact({
        authors: strings(f.authors),
        abstract: str(f.abstract),
        upvotes: count(m.score),
      })
    } else if (m.source === 'news' && !facts.article) {
      facts.article = compact({
        site: hostOf(m.url) ?? hostOf(canonicalUrl),
        author: str(m.author),
      })
    }
  }
  const host = hostOf(canonicalUrl)
  if (!facts.article && host && !NON_ARTICLE_HOSTS.test(host) && !facts.paper) {
    facts.article = { site: host }
  }
  for (const key of Object.keys(facts) as (keyof ItemFacts)[]) {
    if (!facts[key]) delete facts[key]
  }
  return facts
}
