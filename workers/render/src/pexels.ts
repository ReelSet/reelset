import { errorFields, type Logger } from '@reelset/core'

export const PEXELS_SEARCH_URL = 'https://api.pexels.com/videos/search'
export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60_000
export const HOURLY_REQUEST_BUDGET = 180
export const MAX_REEL_CLIPS = 5
const MIN_WIDTH = 1080
const MIN_HEIGHT = 1920
const MIN_SECONDS = 4
const MAX_SECONDS = 45
// The container refuses stock clips over 25 MB (reel/media.py MAX_CLIP_BYTES).
export const MAX_FILE_BYTES = 25 * 1024 * 1024
const USAGE_KEY = 'cache/pexels/usage.json'
const RATE_KEY = 'cache/pexels/rate.json'

export type BrollPick = {
  url: string
  id: number
  beat: number
  seconds: number
  creator: string
  creatorUrl: string
  pageUrl: string
}

type Cached = {
  id: number
  link: string
  width: number
  height: number
  seconds: number
  creator: string
  creatorUrl: string
  pageUrl: string
}

export type Cache = Pick<R2Bucket, 'get' | 'put'>
export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>

const ABSTRACT: [RegExp, string[]][] = [
  // Topic before tooling: an email story gets mail footage, not another keyboard.
  [
    /\b(e-?mails?|inbox\w*|mailbox\w*|mail|spam|bounc\w*|smtp|dmarc|dkim|newsletter)\b/i,
    ['email inbox', 'envelope letters'],
  ],
  [
    /\b(phishing|spoof\w*|impersonat\w*|fraud|scam\w*|password\w*|authenticat\w*)\b/i,
    ['cyber security', 'padlock'],
  ],
  [
    /\b(images?|photos?|pictures?|pixels?|diffusion|lora\w*|render\w*)\b/i,
    ['digital art', 'camera lens'],
  ],
  // Not a bare "domain": in a paper it means a data domain, not DNS.
  [
    /\b(dns|nameservers?|registrars?|domain names?|(dmarc|dns|txt|mx) records?)\b/i,
    ['network cables', 'server room'],
  ],
  [
    /\b(terminal|command|cli|shell|install|npm|pip|script)\b/i,
    ['keyboard typing', 'code on screen'],
  ],
  [
    /\b(server|cloud|deploy|infrastructure|latency|scal\w*|cluster)\b/i,
    ['server room', 'data center'],
  ],
  [
    /\b(chip|gpu|hardware|silicon|inference|cuda|accelerat\w*)\b/i,
    ['circuit board', 'computer chip'],
  ],
  [/\b(network|api|request|protocol|http|traffic|bandwidth)\b/i, ['network cables', 'fiber optic']],
  [/\b(database|query|sql|storage|index|cache)\b/i, ['data center', 'server room']],
  [/\b(security|vulnerabilit\w*|attack|exploit|encrypt\w*)\b/i, ['cyber security', 'padlock']],
  [
    /\b(model|neural|training|learning|paper|benchmark|dataset)\b/i,
    ['abstract data visualization', 'digital particles'],
  ],
  [
    /\b(code|compile\w*|function|bug|library|framework|repo|open source)\b/i,
    ['code on screen', 'keyboard typing'],
  ],
]
const SOURCE_DEFAULT: Record<string, string[]> = {
  github: ['code on screen', 'keyboard typing'],
  hn: ['keyboard typing', 'network cables'],
  reddit: ['keyboard typing', 'code on screen'],
  youtube: ['code on screen', 'server room'],
  papers: ['abstract data visualization', 'circuit board'],
  news: ['data center', 'network cables'],
}
const FALLBACK = ['code on screen', 'keyboard typing']

/** An abstract lowercase search phrase, or null when it looks like a product, person or brand. */
export function cleanTerm(raw: unknown, title: string): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text !== text.toLowerCase()) return null
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0 || words.length > 3 || words.join('').length < 3) return null
  const banned = new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  )
  if (words.some((w) => banned.has(w))) return null
  return words.join(' ')
}

/**
 * Abstract search terms for a beat, best first: the script's own `broll` (1-2), else every matching
 * keyword-map entry (topic before tooling, at most 4), else the source default.
 */
export function termsForBeat(
  beat: { text: string; broll?: readonly string[] },
  source: string | null,
  title: string,
): string[] {
  const given = (beat.broll ?? [])
    .map((t) => cleanTerm(t, title))
    .filter((t): t is string => t !== null)
  if (given.length > 0) return [...new Set(given)].slice(0, 2)
  const matched = ABSTRACT.filter(([re]) => re.test(beat.text)).flatMap(([, terms]) => terms)
  if (matched.length > 0) return [...new Set(matched)].slice(0, 4)
  return SOURCE_DEFAULT[source ?? ''] ?? FALLBACK
}

type PexelsFile = {
  link?: string
  width?: number
  height?: number
  file_type?: string
  size?: number
}
type PexelsVideo = {
  id?: number
  url?: string
  duration?: number
  user?: { name?: string; url?: string }
  video_files?: PexelsFile[]
}

/** Smallest mp4 that is still portrait, at least 1080x1920 and small enough for the container. */
export function pickFile(files: readonly PexelsFile[]): PexelsFile | null {
  const ok = files.filter(
    (f) =>
      typeof f.link === 'string' &&
      f.link.startsWith('https://') &&
      f.file_type === 'video/mp4' &&
      (f.width ?? 0) >= MIN_WIDTH &&
      (f.height ?? 0) >= MIN_HEIGHT &&
      (f.height ?? 0) > (f.width ?? 0) &&
      (f.size ?? 0) <= MAX_FILE_BYTES,
  )
  ok.sort((a, b) => a.width! * a.height! - b.width! * b.height!)
  return ok[0] ?? null
}

export function slimVideos(videos: readonly PexelsVideo[]): Cached[] {
  const out: Cached[] = []
  for (const v of videos) {
    const file = pickFile(v.video_files ?? [])
    if (!file || typeof v.id !== 'number' || !v.url || !v.user?.name) continue
    out.push({
      id: v.id,
      link: file.link!,
      width: file.width!,
      height: file.height!,
      seconds: v.duration ?? 0,
      creator: v.user.name,
      creatorUrl: v.user.url ?? 'https://www.pexels.com',
      pageUrl: v.url,
    })
  }
  return out
}

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function readJson<T>(cache: Cache, key: string): Promise<T | null> {
  try {
    const obj = await cache.get(key)
    return obj ? ((await obj.json()) as T) : null
  } catch {
    return null
  }
}

async function writeJson(cache: Cache, key: string, value: unknown): Promise<void> {
  try {
    await cache.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: 'application/json' },
    })
  } catch {
    // the cache is an optimization
  }
}

export type PexelsDeps = {
  apiKey: string
  fetch: Fetch
  cache: Cache
  log: Logger
  now?: () => number
}

/** Cached (7 days) portrait search; stays inside the hourly request budget by serving cache only when it is spent. */
export async function searchVideos(deps: PexelsDeps, term: string): Promise<Cached[]> {
  const now = deps.now?.() ?? Date.now()
  const key = `cache/pexels/search-${await sha1(term)}.json`
  const hit = await readJson<{ at: number; videos: Cached[] }>(deps.cache, key)
  if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) return hit.videos

  const rate = await readJson<{ start: number; count: number }>(deps.cache, RATE_KEY)
  const hourStart = rate && now - rate.start < 3_600_000 ? rate.start : now
  const count = rate && hourStart === rate.start ? rate.count : 0
  if (count >= HOURLY_REQUEST_BUDGET) {
    deps.log.warn({ term }, 'pexels hourly budget spent, using stale cache only')
    return hit?.videos ?? []
  }
  await writeJson(deps.cache, RATE_KEY, { start: hourStart, count: count + 1 })

  const url = `${PEXELS_SEARCH_URL}?${new URLSearchParams({ query: term, orientation: 'portrait', size: 'medium', per_page: '15' })}`
  try {
    const res = await deps.fetch(url, { headers: { authorization: deps.apiKey } })
    if (!res.ok) {
      deps.log.warn({ term, status: res.status }, 'pexels search failed')
      return hit?.videos ?? []
    }
    const body = (await res.json()) as { videos?: PexelsVideo[] }
    const videos = slimVideos(body.videos ?? [])
    await writeJson(deps.cache, key, { at: now, videos })
    deps.log.info({ term, found: videos.length }, 'pexels search')
    return videos
  } catch (err) {
    deps.log.warn({ term, ...errorFields(err) }, 'pexels search errored')
    return hit?.videos ?? []
  }
}

/**
 * One clip per beat (at most 5 per reel), never the same clip twice in a reel and, across reels, the
 * least-used clip first (usage counts live in the cache bucket). Returns [] when nothing is found.
 */
export async function pickBroll(
  deps: PexelsDeps,
  beats: readonly { text: string; broll?: readonly string[] }[],
  ctx: { source: string | null; title: string },
): Promise<BrollPick[]> {
  const usage = (await readJson<Record<string, number>>(deps.cache, USAGE_KEY)) ?? {}
  const taken = new Set<number>()
  const usedTerms = new Set<string>()
  const picks: BrollPick[] = []
  for (const [index, beat] of beats.entries()) {
    if (picks.length >= MAX_REEL_CLIPS) break
    // A term an earlier beat already used goes last, so the reel is not four keyboards.
    const terms = termsForBeat(beat, ctx.source, ctx.title)
    const ordered = [
      ...terms.filter((t) => !usedTerms.has(t)),
      ...terms.filter((t) => usedTerms.has(t)),
    ]
    for (const term of ordered) {
      const found = (await searchVideos(deps, term))
        .filter((v) => !taken.has(v.id) && v.seconds >= MIN_SECONDS && v.seconds <= MAX_SECONDS)
        .map((v, rank) => ({ v, rank }))
        .sort((a, b) => (usage[a.v.id] ?? 0) - (usage[b.v.id] ?? 0) || a.rank - b.rank)[0]?.v
      if (!found) continue
      taken.add(found.id)
      usedTerms.add(term)
      usage[found.id] = (usage[found.id] ?? 0) + 1
      picks.push({
        url: found.link,
        id: found.id,
        beat: index + 1,
        seconds: Math.min(found.seconds, 6),
        creator: found.creator,
        creatorUrl: found.creatorUrl,
        pageUrl: found.pageUrl,
      })
      break
    }
  }
  if (picks.length > 0) await writeJson(deps.cache, USAGE_KEY, usage)
  deps.log.info({ picks: picks.length, beats: beats.length }, 'b-roll picked')
  return picks
}
